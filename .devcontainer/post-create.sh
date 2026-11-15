#!/usr/bin/env bash
# Prépare un Codespace pour le développement backend MboloChat.
# Ne construit PAS l'APK Android : les modules natifs (mbolo-crypto,
# SQLCipher, FCM) exigent un appareil physique et un runner dédié.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f api/.env ]]; then
  cp api/.env.example api/.env
  echo "[setup] api/.env créé depuis .env.example — renseigne JWT_SECRET."
fi

if [[ ! -f mobile/.env ]]; then
  cp mobile/.env.example mobile/.env
fi

echo "[setup] Installation des dépendances API…"
(cd api && npm install --no-audit --no-fund)

# Le client mobile ne se lance pas dans un Codespace, mais tsc/lint/tests
# de logique pure y fonctionnent.
echo "[setup] Installation des dépendances mobile…"
(cd mobile && npm install --no-audit --no-fund)

echo "[setup] Démarrage de PostgreSQL…"
docker compose up -d

echo "[setup] Terminé. Lance l'API avec : cd api && npm run start:dev"
