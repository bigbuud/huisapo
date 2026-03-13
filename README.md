# 💊 Huisapotheek

Inventarisatie van je huisapotheek — met vervaldatums, categorieën en statuswaarschuwingen.

---
via docker-compose: 
```bash
version: '3.8'

services:
  huisapotheek:
    image: ghcr.io/bigbuud/huisapotheek:latest
    container_name: huisapotheek
    ports:
      - "3520:3520"
    environment:
      - PUID=1026
      - PGID=100
      - TZ=Europe/Brussels
      - APP_USER=jouwgebruikersnaam
      - APP_PASSWORD=jouwwachtwoord
    volumes:
      - /volume1/docker/huisapotheek:/data
    restart: always
```

## 🐳 Synology — User-defined Script

```bash
docker run -d \
  --name=huisapotheek \
  -p 3520:3520 \
  -e PUID=1026 \
  -e PGID=100 \
  -e TZ=Europe/Brussels \
  -e APP_USER=jouwgebruikersnaam \
  -e APP_PASSWORD=jouwwachtwoord \
  -v /volume1/docker/huisapotheek:/data \
  --restart always \
```

> **Pas aan:**
> - `PUID` / `PGID`: zie Synology → Configuratiescherm → Gebruikers (standaard 1026/100)
> - Bereikbaar op `http://SYNOLOGY-IP:3520`

---

## 📦 GitHub → ghcr.io (automatisch bouwen)

### 1. Maak een nieuwe repo aan op GitHub

Ga naar github.com/bigbuud → **New repository** → naam: `huisapotheek`

### 2. Push de code

```bash
git init
git add .
git commit -m "Eerste versie huisapotheek"
git branch -M main
git remote add origin https://github.com/bigbuud/huisapotheek.git
git push -u origin main
```

### 3. GitHub Actions bouwt automatisch

Na de push start GitHub Actions en bouwt de image voor `amd64` én `arm64`.
Je ziet de voortgang op: `https://github.com/bigbuud/huisapotheek/actions`

Duurt ~3 minuten. Daarna staat de image op:
```
ghcr.io/bigbuud/huisapotheek:latest
```

### 4. Package zichtbaar maken (eenmalig)

Ga naar: `https://github.com/bigbuud?tab=packages`  
Klik op het pakket → **Package settings** → **Change visibility** → **Public**

---

## 🔄 Updaten

Als je de code aanpast en pusht naar GitHub, bouwt Actions automatisch een nieuwe image.  
Op de Synology dan:

```bash
docker pull ghcr.io/bigbuud/huisapotheek:latest
docker stop huisapotheek && docker rm huisapotheek
# Voer het docker run commando opnieuw uit
```

---

## 💾 Data

Database staat op: `/volume1/docker/huisapotheek/apotheek.db`  
Backup = gewoon dat bestand kopiëren.
