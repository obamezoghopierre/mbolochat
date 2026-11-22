#!/usr/bin/env bash
#
# Relie Metro (Instabox:8081) à Waydroid sur le PC, via le CLI instabox.
# À lancer sur le PC (pas sur Instabox) :  bash scripts/tunnel-pc.sh
#
set -euo pipefail

# ===================== À MODIFIER =====================
MACHINE=""   # nom de ta machine Instabox (instabox ls pour la trouver)
# =====================================================

step() { printf '\n==> %s\n' "$1"; }
die() { printf 'ERREUR : %s\n' "$1"; exit 1; }

[ -n "$MACHINE" ] || die "Renseigne MACHINE en haut du script (nom de ta machine Instabox)."

step "Tunnel de port 8081 (Metro Instabox -> PC)"
# port-forward reste au premier plan : on le détache pour la suite du script.
setsid instabox port-forward "$MACHINE" 8081:8081 &
sleep 3
pgrep -f "port-forward.*${MACHINE}" \
  || die "Le tunnel a échoué (vérifie MACHINE et que Metro tourne sur Instabox:8081)."
echo "Tunnel actif : localhost:8081 du PC -> Metro sur ${MACHINE}."

step "IP de Waydroid"
WAYDROID_IP=$(waydroid status | grep "IP address" | awk '{print $3}')
[ -n "$WAYDROID_IP" ] || die "Impossible de lire l'IP Waydroid (waydroid status)."
echo "Waydroid : ${WAYDROID_IP}"

step "adb connect ${WAYDROID_IP}:5555"
adb connect "${WAYDROID_IP}:5555" || die "adb connect a échoué."

step "adb reverse tcp:8081"
adb -s "${WAYDROID_IP}:5555" reverse tcp:8081 tcp:8081 \
  || die "adb reverse a échoué."
echo "Reverse actif : l'émulateur voit Metro sur localhost:8081."

printf '\nTerminé. Ouvre MboloChat : le dev-launcher propose http://localhost:8081.\n'
printf 'Pour couper le tunnel plus tard : pkill -f "port-forward.*%s"\n' "$MACHINE"
