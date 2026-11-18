# Accéder à Waydroid depuis le sandbox via Tailscale

## Pourquoi

Le sandbox instabox n'a **aucune entrée réseau** et n'est pas sur le LAN où tourne
Waydroid (`192.168.240.112:5555`). L'ancien montage Codespace
(`gh codespace ssh -R 5555:192.168.240.112:5555`, scripts `scripts/waydroid-tunnel.sh`
et `scripts/setup-adb-tunnel.sh`) ne s'applique plus. Tailscale fournit un réseau
privé qui traverse le NAT : la machine Waydroid annonce son sous-réseau, le sandbox
l'accepte, puis `adb` passe par un forward local.

## 1 — Sur la machine qui héberge Waydroid

1. Installer Tailscale (<https://tailscale.com/download>) et se connecter au
   même tailnet que le sandbox.
2. Annoncer le sous-réseau qui contient Waydroid :

   ```bash
   sudo tailscale up --advertise-routes=192.168.240.0/24
   ```

3. Approuver la route dans <https://login.tailscale.com/admin/settings/routes>
   (machines → … → activer la route). Sans cette approbation, le sandbox voit le
   tailnet mais pas `192.168.240.112`.

La machine doit rester allumée avec Waydroid et son service ADB en écoute sur
`5555` (vérifier localement : `adb connect 192.168.240.112:5555`).

## 2 — Sur ce sandbox (une seule fois)

Tailscale, `adb` et `socat` sont déjà installés. Il reste à authentifier le nœud :

1. Générer une **auth key** dans <https://login.tailscale.com/admin/settings/keys>.
2. Dans le **Terminal du tableau de bord** du sandbox (ne pas coller la clé dans
   le chat) :

   ```bash
   install -d -m 700 ~/.config/mbolochat
   cat > ~/.config/mbolochat/tailscale-authkey
   # coller la clé, Entrée, puis Ctrl+D
   chmod 600 ~/.config/mbolochat/tailscale-authkey
   ```

Le script lit cette clé, ne l'affiche jamais et ne la versionne pas
(`.gitignore` → `tailscale-authkey`).

## 3 — Usage quotidien

Depuis la racine du dépôt :

```bash
./scripts/waydroid-tailscale.sh          # connexion + forward 127.0.0.1:5555
./scripts/waydroid-tailscale.sh status   # état Tailscale / route / adb
./scripts/waydroid-tailscale.sh down     # arrêter le forward local
```

Le forward tourne en tâche de fond (PID dans `/tmp/mbolochat-waydroid-5555.pid`,
logs dans `/tmp/mbolochat-waydroid-5555.log`).

Personnalisation : `ADB_DEVICE=192.168.240.112:5555`, `LOCAL_PORT=5555`,
`TAILSCALE_AUTHKEY_FILE=/chemin/cle`, `TAILSCALE_HOSTNAME` (vide par défaut : le
nom du nœud Tailscale n'est pas modifié).

## 4 — Tester l'application

Une fois l'appareil listé par `adb devices` :

```bash
adb reverse tcp:8081 tcp:8081   # Metro (Expo)
adb reverse tcp:3001 tcp:3001   # API NestJS
```

Le client Expo develop doit alors charger le bundle depuis `localhost:8081` et
l'API depuis `localhost:3001` à travers l'appareil. Le workflow de build reste
celui de `AGENTS.md` (build via `npm run build:android` sur Waydroid ou EAS, pas
de build lourd local).

## Dépannage

| Symptôme | Cause probable | Correctif |
| --- | --- | --- |
| `Tailscale n'est pas connecté` | clé absente ou expirée | régénérer la clé et la replacer dans le fichier |
| `192.168.240.112:5555 n'est pas joignable` | route non approuvée | approuver la route dans l'admin Tailscale |
| `adb devices` vide | ADB Waydroid éteint | `adb connect 192.168.240.112:5555` sur la machine hôte |
| `port 5555 occupé` | ancien forward resté | `./scripts/waydroid-tailscale.sh down` |
