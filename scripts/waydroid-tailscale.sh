#!/usr/bin/env bash
# Accès à Waydroid depuis ce sandbox via Tailscale.
#
# Principe : le sandbox n'a aucune entrée réseau et ne voit pas le LAN où tourne
# Waydroid (192.168.240.112). Tailscale crée un réseau privé qui traverse le NAT :
# la machine qui héberge Waydroid annonce son sous-réseau, ce sandbox l'accepte,
# puis un forward local expose adb sur 127.0.0.1:5555.
#
# Prérequis sur la MACHINE QUI HÉBERGE WAYDROID :
#   sudo tailscale up --advertise-routes=192.168.240.0/24
#   puis approuver la route dans https://login.tailscale.com/admin/settings/routes
#
# Prérequis sur CE SANDBOX (une seule fois) :
#   - générer une clé d'authentification dans
#     https://login.tailscale.com/admin/settings/keys
#   - la écrire dans ~/.config/mbolochat/tailscale-authkey (chmod 600),
#     ou exporter TAILSCALE_AUTHKEY. La clé n'est jamais affichée par ce script.
#
# Usage :
#   ./scripts/waydroid-tailscale.sh                  # monter le tunnel
#   ./scripts/waydroid-tailscale.sh status           # état du tunnel et d'adb
#   ./scripts/waydroid-tailscale.sh down             # couper le forward local
#   ./scripts/waydroid-tailscale.sh -d 192.168.240.112:5555 -p 5555
#
# Variables d'environnement : ADB_DEVICE, LOCAL_PORT, TAILSCALE_AUTHKEY,
# TAILSCALE_AUTHKEY_FILE, TAILSCALE_HOSTNAME.
set -euo pipefail

ADB_DEVICE="${ADB_DEVICE:-192.168.240.112:5555}"
LOCAL_PORT="${LOCAL_PORT:-5555}"
AUTHKEY_FILE="${TAILSCALE_AUTHKEY_FILE:-$HOME/.config/mbolochat/tailscale-authkey}"
TAILSCALE_HOSTNAME="${TAILSCALE_HOSTNAME:-}"  # vide = garder le nom du nœud
PID_FILE="${TMPDIR:-/tmp}/mbolochat-waydroid-${LOCAL_PORT}.pid"
LOG_FILE="${TMPDIR:-/tmp}/mbolochat-waydroid-${LOCAL_PORT}.log"

usage() { sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; }

die() { echo "❌ $*" >&2; exit 1; }
log() { echo "→ $*"; }

ACTION="${1:-up}"
case "$ACTION" in
  up | down | status)
    if [[ $# -gt 0 ]]; then shift; fi
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *) die "Action inconnue : $ACTION (attendu : up, down, status)" ;;
esac

while getopts ":d:p:k:h" opt; do
  case "$opt" in
    d) ADB_DEVICE="$OPTARG" ;;
    p) LOCAL_PORT="$OPTARG" ;;
    k) AUTHKEY_FILE="$OPTARG" ;;
    h)
      usage
      exit 0
      ;;
    :)
      die "Option -$OPTARG attend un argument."
      ;;
    \?)
      die "Option inconnue : -$OPTARG"
      ;;
  esac
done
shift $((OPTIND - 1))

for tool in tailscale sudo socat adb jq nc ss; do
  command -v "$tool" >/dev/null 2>&1 || die "La commande '$tool' est introuvable."
done

host="${ADB_DEVICE%:*}"
port="${ADB_DEVICE##*:}"
if [[ "$host" == "$ADB_DEVICE" ]]; then
  port=5555
fi
[[ "$port" =~ ^[0-9]+$ ]] || die "Port invalide dans ADB_DEVICE : $ADB_DEVICE"
[[ "$LOCAL_PORT" =~ ^[0-9]+$ ]] || die "Port local invalide : $LOCAL_PORT"

backend_state() {
  tailscale status --json 2>/dev/null | jq -r '.BackendState // empty' || true
}

case "$ACTION" in
  down)
    if [[ -f "$PID_FILE" ]]; then
      pid="$(cat "$PID_FILE")"
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" && log "Forward local arrêté (PID $pid)."
      fi
      rm -f "$PID_FILE"
    else
      log "Aucun forward local à arrêter."
    fi
    adb disconnect "127.0.0.1:${LOCAL_PORT}" >/dev/null 2>&1 || true
    exit 0
    ;;

  status)
    echo "=== Tailscale ==="
    tailscale status 2>&1 || true
    echo "=== Route vers ${host}:${port} ==="
    if nc -z -w 3 "$host" "$port" 2>/dev/null; then
      echo "  joignable"
    else
      echo "  INJOIGNABLE"
    fi
    echo "=== Forward local :${LOCAL_PORT} ==="
    ss -lntp 2>/dev/null | grep ":${LOCAL_PORT} " || echo "  aucun écouteur"
    echo "=== adb ==="
    adb devices
    exit 0
    ;;
esac

# --- 1. Tailscaled ----------------------------------------------------------
if ! systemctl is-active --quiet tailscaled; then
  log "Démarrage de tailscaled…"
  sudo systemctl enable --now tailscaled >/dev/null
fi

# --- 2. Connexion au tailnet ------------------------------------------------
up_args=(--accept-routes)
if [[ -n "$TAILSCALE_HOSTNAME" ]]; then
  up_args+=(--hostname="$TAILSCALE_HOSTNAME")
fi

state="$(backend_state)"
if [[ "$state" != "Running" ]]; then
  key=""
  if [[ -n "${TAILSCALE_AUTHKEY:-}" ]]; then
    key="$TAILSCALE_AUTHKEY"
  elif [[ -r "$AUTHKEY_FILE" ]]; then
    key="$(<"$AUTHKEY_FILE")"
  fi
  key="$(printf '%s' "$key" | tr -d '\r\n')"
  if [[ -z "$key" ]]; then
    cat >&2 <<EOF
❌ Tailscale n'est pas connecté et aucune clé d'authentification n'est disponible.
   Sur la machine qui héberge Waydroid, rien à faire ici : génère une clé dans
   https://login.tailscale.com/admin/settings/keys puis, DEPUIS LE TERMINAL DU
   TABLEAU DE BORD de ce sandbox :

     install -d -m 700 ~/.config/mbolochat
     cat > ~/.config/mbolochat/tailscale-authkey   # coller la clé, puis Ctrl+D
     chmod 600 ~/.config/mbolochat/tailscale-authkey

   Relance ensuite : ./scripts/waydroid-tailscale.sh
EOF
    exit 1
  fi
  log "Connexion au tailnet avec la clé fournie…"
  sudo tailscale up --authkey="$key" "${up_args[@]}" >/dev/null
  unset key
else
  # Déjà connecté : on s'assure seulement que les routes du LAN sont acceptées.
  sudo tailscale up "${up_args[@]}" >/dev/null
fi

for _ in {1..30}; do
  state="$(backend_state)"
  [[ "$state" == "Running" ]] && break
  sleep 1
done
[[ "$state" == "Running" ]] || die "Tailscale n'a pas atteint l'état Running ($state)."
log "Tailscale connecté (${TAILSCALE_HOSTNAME})."

# --- 3. Vérification de la route -------------------------------------------
if ! nc -z -w 3 "$host" "$port" 2>/dev/null; then
  cat >&2 <<EOF
❌ ${host}:${port} n'est pas joignable via Tailscale.
   Sur la machine qui héberge Waydroid :
     sudo tailscale up --advertise-routes=${host%.*}.0/24
   Puis approuve la route dans https://login.tailscale.com/admin/settings/routes
EOF
  exit 1
fi
log "${host}:${port} joignable via Tailscale."

# --- 4. Forward local -------------------------------------------------------
if ss -lnt 2>/dev/null | grep -q ":${LOCAL_PORT} "; then
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    log "Forward localhost:${LOCAL_PORT} déjà actif (PID $(cat "$PID_FILE"))."
  else
    die "Le port local ${LOCAL_PORT} est occupé par un autre processus."
  fi
else
  nohup socat "TCP-LISTEN:${LOCAL_PORT},fork,reuseaddr" "TCP:${host}:${port}" >>"$LOG_FILE" 2>&1 &
  pid=$!
  echo "$pid" >"$PID_FILE"
  log "Forward localhost:${LOCAL_PORT} → ${host}:${port} (PID ${pid})."
fi

# --- 5. adb -----------------------------------------------------------------
adb connect "127.0.0.1:${LOCAL_PORT}" >/dev/null 2>&1 || true
echo
adb devices
echo
log "Test mobile : adb reverse tcp:8081 tcp:8081 et adb reverse tcp:3001 tcp:3001"
log "Puis dans l'app : Expo → … (dev client) ; logs : adb logcat"
