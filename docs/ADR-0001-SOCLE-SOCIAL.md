# ADR-0001 — Socle de données social de MboloChat

- **Statut** : proposé (à relire avant génération de la migration)
- **Date** : 16 novembre 2026
- **Portée** : phase 0 du plan `docs/PLAN-FUSION-MBOLO.md` (§5, §16.3)
- **Décideurs** : à valider par le mainteneur avant `npm run db:generate`

## 1. Contexte

MboloChat (NestJS + PostgreSQL/Drizzle) devient le backend canonique du réseau social
issu de Mbolo (référence produit Firebase, non portée). Le chat E2EE, ses outbox et ses
médias chiffrés restent inchangés : le domaine social est un plan de données **séparé**.

Cet ADR fige les choix de modélisation de la **v1 du schéma** avant toute migration SQL.
Il ne couvre ni les endpoints détaillés (phase 1), ni le pipeline média complet (spike
S3/MinIO), ni le portage UI.

## 2. Décisions

### 2.1 Identité unique et rôle

- `users.id` (UUID texte) reste l'unique identité ; aucun UID Firebase.
- Extension de `users` : `role` (`user|moderator|admin`), `verified`, `private_account`,
  compteurs dénormalisés, et `username_updated_at` pour le cooldown de changement de
  pseudo. Le pseudo public reste `username` (déjà unique).

### 2.2 Publications unifiées

- Un seul agrégat `publications` avec `kind` (`post|reel`) et `format`
  (`text|image|carousel|video`).
- Interactions, commentaires, compteurs, modération et feed sont communs aux deux
  kinds ; seuls la création et le rendu mobile diffèrent.
- Conséquence : pas de tables `posts` / `videos` parallèles, donc pas de duplication de
  la logique de likes, commentaires, signalements et compteurs.

### 2.3 Compteurs dénormalisés, autorité serveur

- Compteurs en `integer NOT NULL DEFAULT 0` sur `users`, `publications`, `comments`
  (`follower_count`, `like_count`, `comment_count`, `view_count`, `usage_count`…).
- Incréments exclusivement en transaction SQL côté API ; le client n'envoie jamais de
  compteur. Un job de recalcul périodique corrigera les dérives.
- `hot_score` (entier) est recalculé par un worker, jamais exposé en écriture.

### 2.4 Visibilité et modération appliquées en SQL

- `publications.visibility` : `public | followers | private`.
- `publications.moderation_status` : `pending | approved | flagged | removed`.
- `private_account` (utilisateur) + `follows.status` (`accepted | pending`) sont la
  source de vérité des comptes privés ; le filtrage se fait dans les requêtes, pas
  seulement dans l'UI.
- `blocked_words` + `reports` + `moderation_actions` fournissent la file de modération
  et son journal d'audit (`moderation_actions` est append-only).

### 2.5 Idempotence des écritures clientes

- `publications` et `comments` portent un `client_id` fourni par l'appareil, unique par
  auteur (`UNIQUE(author_id, client_id)`) : un rejeu après coupure renvoie l'objet
  existant au lieu d'en créer un second.
- Réactions, saves, reposts et vues utilisent des clés primaires composites (pas de
  doublon possible par construction).
- Les notifications sociales sont dédupliquées par `UNIQUE(user_id, dedupe_key)`.

### 2.6 Médias sociaux séparés des médias de chat

- Nouvelles tables `media_assets` (objet S3/R2, variantes, statut) et `media_jobs`
  (file de travail Postgres) : le client n'écrit jamais sans URL présignée, l'asset
  doit être `ready` et appartenir à l'auteur pour être publié.
- La table existante `uploads` et son pipeline signé restent réservés au chat
  (y compris les blobs E2EE). **Aucun mélange** : le social ne référence jamais
  `uploads`, et aucun `asset_id` social n'entre dans le pipeline chiffré.
- `media_jobs` reprend le motif de bail + `claim_token` de `message_events` (reprise
  après redémarrage sans double exécution).

### 2.7 Stories, highlights, sons

- `stories` portent `audience` (`everyone | followers`), `expires_at` (24 h) et une
  table d'exclusions par utilisateur.
- `highlight_items` conserve `asset_id` : un highlight survit à l'expiration — et à la
  purge — de la story d'origine.
- `sounds` référence un `media_asset` et porte un `usage_count` tenu par le serveur ;
  `publications.sound_id` est facultatif.

### 2.8 DTO publics sans PII

Le schéma n'expose pas de données personnelles par lui-même, mais les colonnes
sensibles existantes (`email`, `birthday`, `gender`, `gender_custom`, réglages de
confidentialité) restent hors de tout DTO social. Les projections publiques sont
construites explicitement (pas de `SELECT *` sérialisé) — détail d'implémentation
phase 1.

### 2.9 Pagination par curseur

Toutes les listes sociales sont paginées par `(score, id)` ou `(created_at, id)`, donc
les index posés sont composites et dans cet ordre. Pas de pagination par offset.

## 3. Alternatives écartées

| Alternative | Raison du rejet |
|---|---|
| Garder Firebase/Firestore pour le social | Double stack, double auth, double modération, autorisations client, Functions bloquées par le plan Blaze |
| Tables séparées `posts` / `videos` | Duplication intégrale des interactions, compteurs et modération |
| Compteurs calculés à la lecture (`COUNT(*)`) | Coût non borné sur le feed ; le plan impose le dénormalisé + recalcul |
| Compteurs fournis par le client | Non fiable et manipulable ; viole l'autorité serveur |
| Réutiliser `uploads` pour les médias sociaux | Mélange des plans E2EE/social et du modèle de signature local |
| Visibilité filtrée côté mobile | Contournable ; le plan impose SQL |
| `Typesense`/`Redis` dès la v1 | Complexité inutile avant mesure de charge (PostgreSQL FTS + `pg_trgm` suffisent) |

## 4. Conséquences

- Migration unique créant 18 types, 24 tables et leurs index ; relue et testée sur une
  base vierge (`drizzle-kit migrate` puis retour arrière), puis committée avec
  `meta/_journal.json` et `meta/0038_snapshot.json`.
- **Dérive des snapshots Drizzle** : `drizzle/meta` s'arrêtait à `0026_snapshot.json` ;
  les migrations `0027`→`0037` ont été écrites à la main sans snapshot. `db:generate`
  rejouait donc tout le schéma existant. Le snapshot `0038` généré est conservé comme
  nouvelle base de comparaison : `db:generate` répond désormais « No schema changes ».
  Toute nouvelle migration doit repartir de ce snapshot.
- Les workers (médias, recalcul de compteurs, `hot_score`, purge stories/assets)
  devront être idempotents et reprenables, comme `message_events`.
- Le schéma gonfle la base mais reste isolé : aucune migration existante n'est modifiée,
  aucune colonne du chat n'est renommée.
- Points à trancher à la relecture :
  1. `visibility` d'une publication : faut-il un quatrième niveau `unlisted` (lien
     partageable hors fil) dès la v1 ?
  2. Formes de réaction : `like|love|fire|clap` suffisent-ils, ou faut-il un
     `emoji` libre comme les réactions de messages ?
  3. Purge des `media_assets` orphelins : conservation 30 jours par défaut ?
  4. `publication_views` : garder une ligne par (publication, utilisateur) à vie ou
     fenêtrer les vues uniques par 24 h ?

## 5. Références

- `docs/PLAN-FUSION-MBOLO.md` — feuille de route P0, §4 (invariants), §5 (données).
- `api/src/db/schema.ts` — schéma source unique (section « Social » en fin de fichier).
- `api/src/users/visibility.ts` — `canSee`, base de la politique de visibilité.
- `api/src/db/schema.ts` — `messageEvents`, motif de bail/`claim_token` réutilisé.
