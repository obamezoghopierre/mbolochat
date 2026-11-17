#!/usr/bin/env bash
# Configure le serveur SSH du Codespace pour accepter les tunnels inverses
# (adb over WiFi via `gh codespace ssh -R`).
set -euo pipefail

CONF="/etc/ssh/sshd_config.d/tunnel.conf"

sudo bash -c "cat > $CONF" <<'EOF'
AllowTcpForwarding yes
GatewayPorts clientspecified
PermitTunnel yes
EOF

sudo service ssh restart
echo "[tunnel] SSH configuré pour les tunnels inverses (port 2222)."

if ! command -v adb &>/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq android-tools-adb
  echo "[tunnel] adb installé."
fi

echo ""
echo "=== Utilisation ==="
echo "Depuis ta machine locale (bruneel) :"
echo "  gh codespace ssh -c mbolochat-dev-xr4qxvx76jwqcpxpw -- -N -R 5555:192.168.240.112:5555"
echo ""
echo "Puis dans le Codespace :"
echo "  adb connect localhost:5555"
echo "  adb devices"