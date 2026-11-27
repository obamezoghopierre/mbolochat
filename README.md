# MboloChat

**MboloChat** est une application mobile (Android d'abord) qui fusionne trois domaines autour d'une même identité utilisateur :

- **Messagerie privée chiffrée de bout en bout** — conversations 1-1 et groupes, vocaux, photos, stickers, accusés de réception, push.
- **Réseau social** — fil « Pour toi » / Découvrir façon Instagram, publications (texte, image, carrousel, vidéo/Reel), profils, abonnements, commentaires, stories, collections, recherche et tendances.
- **Appels** — appel voix 1-1 et appel de groupe (WebRTC, signalisation via Socket.IO).

Le tout est adossé à une **API NestJS + Drizzle + PostgreSQL**, à un **cœur de chiffrement Rust** (`crypto/`, basé sur `vodozemac`), et à un **back-office web de modération** (`admin/`).

> Le `README` donne une vue d'ensemble ; pour les règles de contribution, l'architecture et les pièges, voir [`AGENTS.md`](AGENTS.md). La liste des endpoints ci-dessous est indicative et regroupée par domaine — le code (`controllers`, `app.module.ts`, `schema.ts`) fait autorité.

## Stack

| Couche | Stack |
| --- | --- |
| API | NestJS 12, Drizzle ORM, PostgreSQL 16, Socket.IO (REST + WebSocket) |
| Mobile | Expo SDK 58, React Native 0.88, expo-router (Android d'abord, web/iOS ensuite) |
| E2EE | Rust 1.89, `vodozemac` (Megolm/Olm), exposé en `.so` Android via JNI (`mobile/modules/mbolo-crypto`) |
| Admin | Vite, React 19, TypeScript (servi par l'API sous `/admin`) |

## Structure

```text
mbolochat/
├── api/                 # Backend NestJS (REST + WebSocket)
│   ├── src/
│   │   ├── auth/        # inscription, login, refresh/rotation, sessions, reset mdp
│   │   ├── users/       # profil, avatar, blocage, géoloc, push-token, privacy, amis
│   │   ├── conversations/  # 1-1 & groupes, membres, rôles, préférences, read
│   │   ├── chat/        # gateway Socket.IO messagerie (send/ack/read/delete/typing)
│   │   ├── calls/       # gateway Socket.IO appels 1-1 & groupe, ICE servers
│   │   ├── e2ee/        # appareils, prekeys, clés publiques
│   │   ├── feed/        # fil « Pour toi », Découvrir, sauvegardés, sessions figées
│   │   ├── publications/# publications (post/reel), likes, vues, saves, reposts, commentaires
│   │   ├── follows/     # abonnements, followers, demandes, comptes privés
│   │   ├── social-media/# uploads signés S3/R2, gifs, CDN social
│   │   ├── social-notifications/  # notifications sociales
│   │   ├── ranking/     # recalcul de hot_score, purge des sessions
│   │   ├── feedback/    # « Pas intéressé » / auteur masqué
│   │   ├── moderation/  # signalements, mots bloqués, file de modération, audit
│   │   ├── presence/    # présence et réglages de présence
│   │   ├── invites/     # invitations de conversation + invitations publiques (token)
│   │   ├── media/       # médias signés (chat)
│   │   ├── uploads/     # uploads signés (chat)
│   │   ├── search/      # recherche universelle + tendances
│   │   ├── push/        # notifications push (Expo/FCM)
│   │   ├── db/          # schéma Drizzle (source unique) + migrations
│   │   └── worker-media.ts  # file média + recalcul périodique de hot_score
│   ├── drizzle/         # migrations SQL générées
│   └── scripts/         # smokes : WebSocket, push, fiabilité, sécurité, appels
├── mobile/              # App Expo (React Native) — nom affiché : MboloChat
│   └── src/
│       ├── app/         # routes expo-router : (tabs) Fil/Découvrir/Notif/Messages/Profil,
│       │                 #   create/, post/, p/[id], u/[username], call/[id], invite/, settings/
│       ├── features/    # chat, calls, e2ee, groups, social, composer, emoji, stickers,
│       │                 #   voice-notes, presence, location, media, settings
│       ├── components/  # UI partagée (bulles, barre de navigation, lecteur vocal…)
│       ├── lib/         # API client, auth, socket, outbox SQLite, sync, stockage local
│       ├── constants/   # design tokens (theme.ts) — aucune valeur codée en dur
│       └── i18n/        # chaînes françaises (fr.ts)
├── crypto/              # Cœur E2EE Rust (mbolo-crypto, vodozemac) + scripts de build Android
├── admin/               # Back-office web de modération (Vite/React), servi sous /admin
├── docs/                # ADR, backlog (TRAVAIL-RESTANT.md), guides (stickers, emoji…)
└── docker-compose.yml   # PostgreSQL 16 pour le dev
```

## Prérequis

- Node.js 20+ (la CI utilise Node 24)
- Rust 1.89 + NDK Android (uniquement pour modifier/recompiler le cœur crypto ; les `.so` précompilés sont committés)
- PostgreSQL (via Docker : `docker compose up -d`, ou une instance locale)
- Pour tester sur Android : un **development build** (`npx expo run:android` ou `eas build --profile development`). Expo Go ne suffit plus : E2EE, WebRTC, FCM, micro et appareil photo passent par des modules natifs.

## Démarrage

### 1. Base de données

```bash
docker compose up -d
```

### 2. API

```bash
cd api
npm install
cp .env.example .env   # DATABASE_URL, JWT_SECRET, PORT, MEDIA_SECRET, CORS_ORIGINS
npm run start:dev
```

Les migrations SQL s'appliquent automatiquement au démarrage. L'API écoute sur `http://localhost:3001` et sert aussi le bundle web (`mobile/dist`, si présent) et le back-office (`admin/dist`, si présent) sous `/admin`.

Variables utiles (voir `api/.env.example`) : `PORT`, `CORS_ORIGINS` (origines web autorisées, séparées par des virgules), `MEDIA_SECRET` (clé des URLs de médias signées ; `JWT_SECRET` sert de repli), `NODE_ENV` (le code de réinitialisation n'est renvoyé qu'en développement). Les médias **sociaux** utilisent un stockage objet distinct (`SOCIAL_S3_*`) ; une URL publique n'est servie que si l'élément est publiquement cacheable, le reste passe par URL signée courte.

### 3. Worker média (recommandé)

Le fil « Pour toi » dépend de la fraîcheur (`hot_score`) recalculée par le worker :

```bash
cd api && npm run worker:media
```

Sans ce worker lancé, la fraîcheur n'a aucun effet sur « Pour toi ».

### 4. App mobile

```bash
cd mobile
npm install
npx expo run:android       # development build (une fois)
npx expo start --dev-client
```

Scannez le QR code avec le development build sur Android. L'app détecte automatiquement l'IP du PC via Expo ; si besoin, forcez l'URL avec `EXPO_PUBLIC_API_URL=http://<ip-du-pc>:3001 npx expo start --dev-client`.

### 5. Back-office de modération (facultatif)

```bash
cd admin && npm install && npm run build && npm run dev
# servi par l'API sous /admin une fois le build (admin/dist) présent
```

Les rôles `moderator`/`admin` sont attribués avec `node api/scripts/promote-role.mjs <email-ou-pseudo> <role>`.

## Scripts utiles

| Commande | Où | Description |
| --- | --- | --- |
| `npm run start:dev` | api | API en mode watch |
| `npm run worker:media` | api | File média + recalcul périodique de `hot_score` |
| `npm run db:generate` | api | Générer une migration après modif du schéma |
| `npm run db:push` | api | Appliquer le schéma directement (dev) |
| `npm run test:e2e` | api | Tests e2e REST (DB requise) |
| `npm run smoke` | api | Test WebSocket de bout en bout (API requise) |
| `npm run push:smoke` | api | Test des notifications push (API requise, token FCM) |
| `npm run reliability:smoke` | api | Idempotence, accusés, citations, suppression, vocaux (API requise) |
| `npm run security:smoke` | api | Médias signés, rate limit, rôles, en-têtes, jetons (API requise) |
| `npm run calls:smoke` | api | Test des appels 1-1 / groupe (API requise) |
| `npm run lint` / `npm run format` | api | Lint (oxlint) / Prettier |
| `npx tsc --noEmit` | api | Typecheck |
| `npx tsc --noEmit` / `npx expo lint` / `npx expo-doctor` | mobile | Typecheck / lint / diagnostic Expo |
| `npm test` | mobile / admin | Tests Vitest (logique pure, pas de rendu RN) |
| `bash crypto/scripts/check.sh` | crypto | fmt + clippy + tests + licences Rust |

## API en un coup d'œil

Toutes les routes REST ci-dessous sont authentifiées par **Bearer token** (sauf mention), et l'autorisation/cette validation reste **serveur**. Les listes sociales sont paginées par curseur `(score, id)` ou `(created_at, id)` (pas d'offset).

### Auth & compte (`/auth`, `/users`)
- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `POST /auth/refresh` (rotation, access 15 min + refresh 30 j), `POST /auth/logout`
- `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/change-password`
- `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `DELETE /auth/account`
- `GET /users/me`, `PATCH /users/me`, `GET /users/me/settings`, `PATCH /users/me/settings`
- `POST /users/me/avatar`, `DELETE /users/me/avatar`, `POST /users/me/push-token`
- `GET /users/search?q=`, `GET /users/suggestions`, `GET /users/by-username/:username`, `GET /users/:id`
- `GET /users/blocked`, `POST /users/:id/block`, `DELETE /users/:id/block`
- Géolocalisation : `GET /users/geo/reverse`, `GET /users/geo/search`, `POST /users/me/location`, `POST /users/me/birthdate`

### Messagerie (`/conversations`, `/uploads`, `/media`)
- `POST /conversations` (`memberIds`, `name?`, `type?` DIRECT|GROUP), `GET /conversations` (avec `unreadCount`, `pinned`, `muted`, `hidden`, `myRole`, `members[].lastReadAt`)
- `GET /conversations/hidden`, `GET /conversations/sync?since=&limit=`
- `GET /conversations/:id`, `PATCH /conversations/:id`, `POST /conversations/:id/photo`
- `POST /conversations/:id/members`, `DELETE /conversations/:id/members/:userId`, `PATCH /conversations/:id/members/:userId/role` (admin uniquement)
- `PATCH /conversations/:id/preferences` (`pinned?`, `muted?`, `hidden?`), `POST /conversations/:id/read`, `POST /conversations/read-all`
- `GET /conversations/:id/messages`, `GET /conversations/:id/receipts`, `GET /conversations/:id/search`, `GET /conversations/:id/media`
- `POST /uploads` (multipart `file`, `width/height/duration/mime`) → attachement + URL signée
- `GET /media?f=&e=&s=` — média signé, à expiration (la signature autorise, aucune auth)

### E2EE (`/e2ee`)
- `GET /e2ee/status`, `POST /e2ee/devices`, `POST /e2ee/devices/prekeys`, `DELETE /e2ee/devices`
- `GET /e2ee/users/:id/keys` (prekeys publics) — routes désactivées (404) si E2EE est explicitement désactivé

### Réseau social
- **Fil** : `GET /feed` (« Pour toi »), `GET /discover`, `GET /feed/suggested-accounts`; `GET /feed/authored/:userId`, `GET /feed/reposts/:userId`
- **Sauvegardés** : `GET /saved`, `GET /saved/collections`, `POST /saved/collections`, `PATCH/DELETE /saved/collections/:id`, `PUT /saved/:publicationId/collection`
- **Publications** (`/publications`) : `POST /` (texte/image/carrousel/vidéo), `GET /:id`, `PATCH /:id`, `DELETE /:id`
  - Interactions : `POST/DELETE /:id/like`, `POST /:id/view`, `POST/DELETE /:id/save`, `POST/DELETE /:id/repost`, `POST/DELETE /:id/react`
  - Commentaires : `POST /:id/comments`, `GET /:id/comments`, `GET /:id/replies`, `POST/DELETE /:id/pin`
  - Épinglage : `POST/DELETE /:id/pin`
- **Abonnements** (`/users/:id/follow`, `/users/me/follow-requests`) : suivre, ne plus suivre, followers/following, demandes (comptes privés), accepter/rejeter
- **Médias sociaux** (`/media/uploads`) : `POST /` (upload présigné S3/R2), `POST /:id/complete`, `GET /:id` ; `GET /media/uploads/gifs/search`, `POST /media/uploads/gifs/:giphyId`
- **Recherche** : `GET /search?q=`, `GET /search/trending`
- **Notifications sociales** : `GET /social/notifications`, `POST /social/notifications/read`
- **Partage / liens universels** : `GET /p/:id` (page publication), `.well-known/apple-app-site-association`, `.well-known/assetlinks.json`
- **Présence** : `GET /presence`, `GET/PUT /me/presence-settings`
- **Feedback** : `POST /feedback` (« Pas intéressé » / auteur masqué), `GET /feedback`, `DELETE /feedback/:targetType/:targetId`
- **Modération** (`/reports`) : `POST /reports`, `GET /reports`, `POST /reports/:id/decision` ; `GET /flagged`, `POST /flagged/:id/decision` ; `GET/POST/DELETE /blocked-words`, `GET /moderation/users`, `GET /moderation/audit`

### Appels (`/calls`)
- `GET /calls/ice-servers` (serveurs STUN/TURN pour WebRTC)
- Signalisation temps réel via Socket.IO (voir ci-dessous)

### Invitations (`/conversations/:id/invites`, `/invites`)
- Invitations de conversation : `POST/GET /conversations/:id/invites`, `DELETE /conversations/:id/invites/:inviteId`, `GET /conversations/:id/join-requests`, `POST /conversations/:id/join-requests/:requestId/resolve`
- Invitations publiques (lien) : `GET /invites/:token`, `POST /invites/:token/join`

### Temps réel — Socket.IO
Auth par `auth.token` (access token 15 min).

**Messagerie** (`api/src/chat`) :
- `conversation:join` / `conversation:focus` / `conversation:blur` `{ conversationId }`
- `message:send` `{ conversationId, content, clientId?, replyToId?, attachmentId? }` (ack idempotent via `clientId`) → `message:new`
- `message:ack` `{ messageIds }` → `receipt` ; `message:read` `{ conversationId }` → broadcast `read` + `receipt`
- `message:delete` `{ conversationId, messageId, forEveryone }` → `message:deleted`
- `typing` `{ conversationId, text }` (throttle 150 ms) → rebroadcast `typing`

**Appels** (`api/src/calls`) :
- 1-1 : `call:invite`, `call:offer`, `call:answer`, `call:ice`, `call:accept`, `call:reject`, `call:cancel`, `call:end`, `call:video-toggle` → broadcasts `call:incoming`, `call:ringing`, `call:accepted`, `call:rejected`, `call:cancelled`, `call:ended`, `call:missed`, `call:video-toggle`
- Groupe : `gcall:start`, `gcall:offer`, `gcall:answer`, `gcall:ice`, `gcall:add`, `gcall:leave`, `gcall:kick`, `gcall:mute`, `gcall:media`, `gcall:video`, `gcall:decline`

## Fonctionnalités livrées

**Messagerie & E2EE**
- Chiffrement de bout en bout (Rust `vodozemac` + `mbolo-crypto`), actif par défaut côté API et mobile ; le serveur ne déchiffre ni ne journalise de clair.
- Conversations 1-1 et groupes : création, renommage, ajout/retrait de membres, **rôles admin/membre** (le dernier admin partant promeut un autre).
- Messages : photos (galerie/appareil photo), **vocaux** (enregistrement, durée, lecture), citations/réponses, copie.
- **Stickers 100 % maison** (références `pack/sticker`, aucun fichier envoyé) ; **Fluent Emoji 3D** embarqué (WebP), texte message en Unicode standard.
- Modération message : suppression pour soi (vue masquée) ou pour tous (auteur, tombstone « Message supprimé »).
- **Fiabilité** : outbox SQLite persistée sur l'appareil, `clientId` idempotent serveur, rattrapage `GET /conversations/sync` ; accusés reçu/lu diffusés en temps réel.
- Notifications push (Expo/FCM) filtrées quand la conversation est ouverte ; blocage/déblocage d'utilisateurs.

**Réseau social**
- Fil classé « Pour toi » + onglet Découvrir, pagination par **sessions figées** (le curseur sur `hot_score` dérive à chaque interaction — ne pas le réintroduire).
- Publications `post`/`reel` aux formats texte / image / carrousel / vidéo, avec filtres, polices/alignement/fond persistés, localisation facultative, aperçu de lien.
- Profils publics (`/u/:username`), abonnements/followers, **comptes privés** (demandes acceptées/rejetées), commentaires, likes/saves/reposts/vues, collections sauvegardées.
- Recherche universelle + tendances (hashtags), notifications sociales, stories/highlights/sons (schéma posé, voir ADR-0001).
- **Visibilité et modération en SQL** (`api/src/users/visibility.ts`) : `public|followers|private`, `pending|approved|flagged|removed` ; signalements, mots bloqués, file de modération et journal d'audit (`moderation_actions` append-only).
- Géolocalisation (reverse géocodage Nominatim), présence, feedback « Pas intéressé ».
- URLs de médias sociaux servies par stockage objet + URL signée courte (jamais de clé S3 exposée) ; les médias de chat restent isolés (`uploads`).

**Appels**
- Appel voix 1-1 et **appel de groupe** (WebRTC) avec signalisation Socket.IO, serveurs ICE configurables, reconnexion ICE.

**Back-office**
- Back-office web de modération (file de signalements, file de contenus signalés, mots bloqués, gestion des utilisateurs, audit) servi sous `/admin`.

## Sécurité & invariants
- URLs de médias **signées et expirantes** (chat et social), rate limiting, en-têtes Helmet, CORS restreint par `CORS_ORIGINS`.
- Jetons push liés au compte ; refresh tokens avec rotation ; sessions révoquables.
- Autorisation et compteurs **côté serveur** ; aucune PII dans les DTO publics.
- E2EE non contournable : le serveur ne reçoit jamais de clé privée ; les clés sont protégées par le Keystore Android + SQLCipher.

## Émojis et stickers
Les messages restent du **texte Unicode standard** (compatible notifications et autres clients). L'application les affiche avec le pack **Fluent Emoji 3D** (Microsoft, MIT) généré dans `mobile/assets/emoji` (~1 586 emoji WebP 64 px). Un emoji absent retombe sur la police système. Les stickers sont des **références** (`pack/sticker`) : aucun fichier n'est envoyé dans le message ; guide d'ajout de packs dans [`docs/STICKERS.md`](docs/STICKERS.md). GIPHY a été retiré ; les anciens GIF déjà enregistrés restent affichés.

## Limites actuelles / prochaines étapes
Voir le backlog daté [`docs/TRAVAIL-RESTANT.md`](docs/TRAVAIL-RESTANT.md) pour le détail. Grands chantiers ouverts :
- **Appels** : vérification matérielle (Galaxy + Waydroid), interruptions GSM / focus audio natif, détection réseau (ICE), **persistance des sessions d'appel** (`call_sessions`/`call_participants`), lot natif Android (service premier plan, notif plein écran groupe, orientation, netinfo).
- **Vidéo de groupe / SFU** : la porte est ouverte dans le moteur (`send(event, { to })`), rien n'est encore implémenté.
- **Social** : stories/highlights/sons (schéma posé, portage UI à venir), recherche dans les messages, envoi réel des codes de réinitialisation (renvoyés en dev uniquement).
- **Finitions** : dette lint préexistante, i18n, nettoyage des couleurs codées en dur, accessibilité, CI/CD et déploiement (Docker).
- **Stockage** : médias en stockage local (chat) et objet (social) à industrialiser (S3/CDN en production) ; build iOS (EAS, même code).

> Note technique : l'ORM est **Drizzle** (TypeScript pur) plutôt que Prisma, dont les moteurs binaires étaient bloqués dans l'environnement de développement initial ; Drizzle reste un choix moderne et léger pour ce projet.
