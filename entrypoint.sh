#!/bin/sh
set -e

mkdir -p /data

PUID=${PUID:-1000}
PGID=${PGID:-1000}

if ! getent group "$PGID" > /dev/null 2>&1; then
    addgroup -g "$PGID" apotheek
fi

if ! getent passwd "$PUID" > /dev/null 2>&1; then
    adduser -D -u "$PUID" -G "$(getent group "$PGID" | cut -d: -f1)" apotheek
fi

chown -R "$PUID:$PGID" /data

echo "======================================"
echo "  💊 HuisApo"
echo "  PUID=$PUID | PGID=$PGID"
echo "  TZ=${TZ:-niet ingesteld}"
echo "  Poort: 3522"
echo "======================================"

exec supervisord -c /etc/supervisor/conf.d/supervisord.conf
