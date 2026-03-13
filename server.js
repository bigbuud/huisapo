const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const session = require('express-session');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

// ── Session ──
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 } }));

const APP_USER = process.env.APP_USER || 'apotheek';
const APP_PASSWORD = process.env.APP_PASSWORD || 'apotheek';

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.status(401).json({ error: 'Niet ingelogd' });
}

app.post('/api/login', (req, res) => {
  const { gebruiker, wachtwoord } = req.body;
  if (gebruiker === APP_USER && wachtwoord === APP_PASSWORD) {
    req.session.loggedIn = true;
    req.session.gebruiker = gebruiker;
    return res.json({ success: true });
  }
  setTimeout(() => res.status(401).json({ error: 'Ongeldige gebruikersnaam of wachtwoord' }), 1000);
});
app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/auth/check', (req, res) => {
  if (req.session && req.session.loggedIn) return res.json({ loggedIn: true, gebruiker: req.session.gebruiker });
  res.json({ loggedIn: false });
});

// ── Database ──
const dataDir = '/data';
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'apotheek.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS medicijnen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    naam TEXT NOT NULL,
    categorie TEXT NOT NULL,
    vervaldatum TEXT NOT NULL,
    hoeveelheid TEXT,
    eenheid TEXT,
    locatie TEXT,
    notities TEXT,
    bijsluiter_url TEXT,
    barcode TEXT,
    sam_cnk TEXT,
    toegevoegd_op TEXT DEFAULT (date('now'))
  );
  CREATE TABLE IF NOT EXISTS geneesmiddelen_db (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    naam TEXT NOT NULL,
    categorie TEXT NOT NULL,
    bijsluiter_url TEXT,
    barcode TEXT,
    cnk TEXT
  );
`);

try { db.exec('ALTER TABLE medicijnen ADD COLUMN bijsluiter_url TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE medicijnen ADD COLUMN barcode TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE medicijnen ADD COLUMN sam_cnk TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE geneesmiddelen_db ADD COLUMN barcode TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE geneesmiddelen_db ADD COLUMN cnk TEXT'); } catch(e) {}
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_geneesmiddelen_naam ON geneesmiddelen_db(naam)'); } catch(e) {}

// ── SAM CIVICS helper ──
function fetchFromSAM(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.vas.ehealth.fgov.be',
      port: 443,
      path: '/websamcivics/samcivics' + apiPath,
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'HuisApo/1.0' }
    };
    const req = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          if (response.statusCode === 200) { resolve(JSON.parse(data)); }
          else { reject(new Error('SAM status ' + response.statusCode + ': ' + data)); }
        } catch (e) { resolve({ raw: data, statusCode: response.statusCode }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('SAM timeout')); });
    req.end();
  });
}

// ── SAM API endpoints ──
app.get('/api/sam/barcode/:barcode', requireAuth, async (req, res) => {
  const { barcode } = req.params;
  const local = db.prepare('SELECT * FROM geneesmiddelen_db WHERE barcode = ? LIMIT 1').get(barcode);
  if (local) return res.json({ source: 'local', data: local });
  try {
    const samData = await fetchFromSAM('/findMedicinalProducts?barcode=' + encodeURIComponent(barcode));
    return res.json({ source: 'sam', data: samData });
  } catch (err) {
    return res.status(404).json({ error: 'Niet gevonden', details: err.message });
  }
});

app.get('/api/sam/zoek', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  try {
    const samData = await fetchFromSAM('/findMedicinalProducts?productName=' + encodeURIComponent(q));
    return res.json({ source: 'sam', data: samData });
  } catch (err) {
    return res.status(500).json({ error: 'SAM fout', details: err.message });
  }
});

app.get('/api/sam/bijsluiter/:cnk', requireAuth, async (req, res) => {
  const { cnk } = req.params;
  try {
    const samData = await fetchFromSAM('/findMedicinalProducts?cnk=' + encodeURIComponent(cnk));
    return res.json({ source: 'sam', data: samData });
  } catch (err) {
    return res.status(500).json({ error: 'SAM fout', details: err.message });
  }
});

// ── Autocomplete ──
app.get('/api/zoek-geneesmiddel', requireAuth, (req, res) => {
  const q = req.query.q || '';
  if (q.length < 2) return res.json([]);
  const results = db.prepare('SELECT naam, categorie, bijsluiter_url, barcode, cnk FROM geneesmiddelen_db WHERE naam LIKE ? ORDER BY naam ASC LIMIT 8').all(q + '%');
  const contains = db.prepare('SELECT naam, categorie, bijsluiter_url, barcode, cnk FROM geneesmiddelen_db WHERE naam LIKE ? AND naam NOT LIKE ? ORDER BY naam ASC LIMIT 4').all('%' + q + '%', q + '%');
  res.json([...results, ...contains].slice(0, 8));
});

app.get('/api/locaties', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT DISTINCT locatie FROM medicijnen WHERE locatie IS NOT NULL AND locatie != "" ORDER BY locatie ASC').all();
  const defaults = ['Badkamerkast', 'Keukenkast', 'EHBO-koffer', 'Nachtkastje', 'Garageapotheekkast', 'Reistas'];
  const fromDb = rows.map(r => r.locatie);
  const all = [...new Set([...fromDb, ...defaults.filter(d => !fromDb.map(l=>l.toLowerCase()).includes(d.toLowerCase()))])];
  res.json(all);
});

// ── Medicijnen CRUD ──
app.get('/api/medicijnen', requireAuth, (req, res) => {
  const { categorie, zoek, sorteer } = req.query;
  let query = 'SELECT * FROM medicijnen WHERE 1=1';
  const params = [];
  if (categorie && categorie !== 'alle') { query += ' AND categorie = ?'; params.push(categorie); }
  if (zoek) { query += ' AND (naam LIKE ? OR notities LIKE ? OR barcode LIKE ?)'; params.push('%'+zoek+'%', '%'+zoek+'%', '%'+zoek+'%'); }
  switch (sorteer) {
    case 'naam': query += ' ORDER BY naam ASC'; break;
    case 'categorie': query += ' ORDER BY categorie ASC, naam ASC'; break;
    case 'vervaldatum_asc': query += ' ORDER BY vervaldatum ASC'; break;
    case 'vervaldatum_desc': query += ' ORDER BY vervaldatum DESC'; break;
    default: query += ' ORDER BY vervaldatum ASC';
  }
  res.json(db.prepare(query).all(...params));
});

app.get('/api/medicijnen/barcode/:barcode', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM medicijnen WHERE barcode = ? LIMIT 1').get(req.params.barcode);
  if (!row) return res.status(404).json({ error: 'Niet gevonden' });
  res.json(row);
});

app.get('/api/medicijnen/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM medicijnen WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Niet gevonden' });
  res.json(row);
});

app.post('/api/medicijnen', requireAuth, (req, res) => {
  const { naam, categorie, vervaldatum, hoeveelheid, eenheid, locatie, notities, bijsluiter_url, barcode, sam_cnk } = req.body;
  if (!naam || !categorie || !vervaldatum) return res.status(400).json({ error: 'Naam, categorie en vervaldatum zijn verplicht' });
  const result = db.prepare('INSERT INTO medicijnen (naam, categorie, vervaldatum, hoeveelheid, eenheid, locatie, notities, bijsluiter_url, barcode, sam_cnk) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(naam, categorie, vervaldatum, hoeveelheid||null, eenheid||null, locatie||null, notities||null, bijsluiter_url||null, barcode||null, sam_cnk||null);
  res.status(201).json(db.prepare('SELECT * FROM medicijnen WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/medicijnen/:id', requireAuth, (req, res) => {
  const { naam, categorie, vervaldatum, hoeveelheid, eenheid, locatie, notities, bijsluiter_url, barcode, sam_cnk } = req.body;
  if (!db.prepare('SELECT id FROM medicijnen WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Niet gevonden' });
  db.prepare('UPDATE medicijnen SET naam=?, categorie=?, vervaldatum=?, hoeveelheid=?, eenheid=?, locatie=?, notities=?, bijsluiter_url=?, barcode=?, sam_cnk=? WHERE id=?')
    .run(naam, categorie, vervaldatum, hoeveelheid||null, eenheid||null, locatie||null, notities||null, bijsluiter_url||null, barcode||null, sam_cnk||null, req.params.id);
  res.json(db.prepare('SELECT * FROM medicijnen WHERE id = ?').get(req.params.id));
});

app.delete('/api/medicijnen/:id', requireAuth, (req, res) => {
  if (!db.prepare('SELECT id FROM medicijnen WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Niet gevonden' });
  db.prepare('DELETE FROM medicijnen WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/statistieken', requireAuth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const soon = new Date(); soon.setMonth(soon.getMonth() + 3);
  const soonDate = soon.toISOString().split('T')[0];
  const totaal = db.prepare('SELECT COUNT(*) as c FROM medicijnen').get().c;
  const verlopen = db.prepare('SELECT COUNT(*) as c FROM medicijnen WHERE vervaldatum < ?').get(today).c;
  const binnenkort = db.prepare('SELECT COUNT(*) as c FROM medicijnen WHERE vervaldatum >= ? AND vervaldatum <= ?').get(today, soonDate).c;
  res.json({ totaal, verlopen, binnenkort, ok: totaal - verlopen - binnenkort,
    perCategorie: db.prepare('SELECT categorie, COUNT(*) as aantal FROM medicijnen GROUP BY categorie ORDER BY aantal DESC').all() });
});

// ── Seed ──
const count = db.prepare('SELECT COUNT(*) as c FROM medicijnen').get();
if (count.c === 0) {
  const ins = db.prepare('INSERT INTO medicijnen (naam, categorie, vervaldatum, hoeveelheid, eenheid, locatie, notities) VALUES (?, ?, ?, ?, ?, ?, ?)');
  ins.run('Paracetamol 500mg', 'pijnstiller', '2026-08-01', '20', 'tabletten', 'badkamerkast', 'Standaard pijnstiller');
  ins.run('Ibuprofen 400mg', 'pijnstiller', '2024-12-01', '12', 'tabletten', 'badkamerkast', 'Anti-ontstekend');
  ins.run('Rennie', 'spijsvertering', '2026-03-01', '36', 'tabletten', 'keukenkast', 'Maagzuur');
  ins.run('Bepanthen zalf', 'zalf/huid', '2027-01-01', '30', 'gram', 'badkamerkast', 'Wondverzorging');
  ins.run('Vitamine D3 1000IE', 'vitaminen', '2026-12-01', '90', 'capsules', 'keukenkast', '1000 IE per dag');
  ins.run('Cetirizine 10mg', 'allergie', '2026-09-01', '20', 'tabletten', 'badkamerkast', 'Hooikoorts');
  ins.run('Thermometer digitaal', 'hulpmiddel', '2099-01-01', '1', 'stuks', 'badkamerkast', 'Digitaal');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('HuisApo API draait op poort ' + PORT));
