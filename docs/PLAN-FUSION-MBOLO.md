# Plan prioritaire — fusion Mbolo × MboloChat

> **Statut : P0 — priorité produit et technique.**
> Décision validée le 16 novembre 2026. Ce document est la feuille de route de référence
> pour faire des deux applications un seul réseau social.
> Tant que la fusion n'est pas livrée, les fonctionnalités non bloquantes du backlog
> (`TRAVAIL-RESTANT.md`) sont reportées après les jalons décrits ici.

## 1. Objectif

Fusionner :

- **MboloChat** (`api/`, `mobile/`) : messagerie E2EE, groupes, appels audio/vidéo,
  outbox SQLite, notifications push, API NestJS/PostgreSQL.
- **Mbolo** (`mbolo/`) : réseau social Firebase (feed, posts, reels, stories, follows,
  recherche, notifications, modération, insights).

En un seul produit : **un compte, une app mobile, un backend, une expérience cohérente**,
sans dégrader les garanties E2EE existantes.

## 2. Décisions d'architecture validées

| Sujet | Décision |
|---|---|
| Backend canonique | **NestJS + PostgreSQL/Drizzle** ; Firebase retiré de la cible |
| Base mobile | **MboloChat Expo 58 / RN 0.88** ; Mbolo sert de référence produit |
| Données existantes | **Aucune à migrer** : base propre, pas de reprise Firestore |
| Priorité de sortie | **Fusion complète avant lancement public** |
| Médias sociaux | **S3/R2 + CDN**, URLs présignées, worker de transcodage |
| Studio de création V1 | **Simple** : capture, galerie, recadrage image, upload, publication. Édition avancée ensuite |
| Plateformes V1 | **Android d'abord**, web en consultation, iOS ensuite |
| Langues V1 | **Français seul**, centralisé dans `mobile/src/i18n/fr.ts` |
| Modération | **Back-office web minimal** obligatoire avant ouverture publique |
| Navigation | Tabs **Feed / Découvrir / Créer / Messages / Profil** |
| Modèle social | **Publications unifiées** (posts + reels) |
| Pseudo | **Pseudo public modifiable**, unique, avec cooldown |
| Feed local | **Ville** en V1, geohash/rayon ensuite |

## 3. Architecture cible

```text
Android/iOS/Web (Expo 58 / RN 0.88)
        │ REST + Socket.IO
        ▼
NestJS API ── PostgreSQL/Drizzle
        ├── S3/R2 + CDN (médias sociaux)
        ├── worker média (sharp/ffmpeg, file Postgres)
        └── Expo Push (existant)

Chat E2EE + appels : SQLCipher + mbolo-crypto, inchangés
Social : contenu lisible serveur, autorisation serveur
mbolo/ : référence produit, pas une dépendance
```

Justification :

- MboloChat apporte le socle sécurisé, l'autorité serveur et l'infrastructure déjà testée.
- Mbolo apporte le produit social, mais repose sur Firestore, des règles non déployées,
  des Cloud Functions bloquées par le plan Blaze et des autorisations trop souvent
  appliquées côté client.
- Conserver Firebase pérenniserait une double stack, une double auth, une double
  modération et une dette de sécurité.

## 4. Invariants non négociables

1. **Séparation des plans de données** : le social ne passe jamais dans le pipeline E2EE ;
   aucun contenu social, clé ou ciphertext de chat ne se retrouve dans l'autre domaine.
2. **Une seule identité** : `users.id` (UUID) partout ; aucun UID Firebase dans la cible.
3. **Autorité serveur** : compteurs, visibilité, modération, notifications et permissions
   sont calculés côté API.
4. **Médias par URLs présignées** : le client n'écrit jamais directement dans le stockage
   sans autorisation serveur.
5. **Pas de PII publique** : email, date de naissance, coordonnées et réglages privés
   exclus des DTO publics.
6. **Visibilité en SQL** : comptes privés, followers, blocages et statut de modération
   filtrés dans les requêtes, pas seulement dans l'UI.
7. **Design system unique** : tokens de `mobile/src/constants/theme.ts`, pas de NativeWind ;
   textes en français dans `mobile/src/i18n/fr.ts`.
8. **Idempotence** : `clientId` pour publications/commentaires, clés primaires pour
   réactions/saves/reposts.
9. **Modération avant ouverture publique** : signalements, file de modération et rôle
   admin opérationnels avant tout feed ouvert.

## 5. Modèle de données cible

Nouvelles tables Drizzle dans `api/src/db/schema.ts` :

| Table | Rôle | Points clés |
|---|---|---|
| `users` (extension) | Identité sociale | `role`, `verified`, `private_account`, compteurs followers/following/posts/reels/likes |
| `user_social_settings` | Préférences sociales | qui peut commenter/mentionner/reposter, audience stories, notifications sociales |
| `follows` | Graphe social | `follower_id`, `following_id`, état `accepted\|pending`, PK composite |
| `publications` | Posts et reels unifiés | `kind post\|reel`, format, visibilité, statut modération, `hot_score`, compteurs, `client_id` unique par auteur |
| `publication_media` | Médias attachés | ordre, type image/vidéo, `asset_id` |
| `comments` + `comment_likes` | Commentaires/réponses | `parent_id`, compteurs, modération, `client_id` |
| `publication_reactions` | Réactions | `like\|love\|fire\|clap`, PK (publication, user) |
| `publication_saves` | Enregistrements | PK (publication, user) |
| `publication_reposts` | Reposts | PK (publication, user) |
| `publication_views` | Vues uniques | PK (publication, user), horodatage |
| `hashtags` + `publication_hashtags` | Hashtags | compteur d'usage, score de tendance |
| `sounds` | Sons des reels | asset, durée, compteur d'utilisation |
| `stories`, `story_views`, `story_excluded_users` | Stories 24 h | `expires_at`, audience, exclusions |
| `highlights`, `highlight_items` | Highlights | conservation des assets après expiration de la story |
| `social_notifications` | Notifications | type, acteur, cible, `dedupe_key`, `read_at` |
| `reports`, `moderation_actions`, `blocked_words` | Modération | file de signalements, audit, mots bloqués |
| `media_assets`, `media_jobs` | Pipeline média | clé S3, variantes, statut, jobs de transcodage |

Choix structurant : **unifier posts et reels dans `publications`**. Les interactions,
commentaires, compteurs et la modération sont identiques ; seuls la création et le rendu
diffèrent. Cela évite de dupliquer toute la logique de Mbolo entre `posts` et `videos`.

Règles de comptage :

- compteurs dénormalisés incrémentés en transaction SQL, jamais envoyés par le client ;
- job de recalcul périodique pour corriger les dérives ;
- pagination par curseur `(score, id)` ou `(created_at, id)`, jamais par offset ;
- colonnes de compteurs sur `publications`, `comments` et `users`.

## 6. Backend NestJS

Nouveaux modules dans `api/src/` :

| Module | Responsabilité |
|---|---|
| `media` (social) | Presign upload, confirmation, variantes, suppression, quotas |
| `publications` | Posts/reels, commentaires, réactions, saves, reposts, vues |
| `follows` | Follow/unfollow, demandes, listes, blocages |
| `feed` | Classement Pour toi / Abonnements / Local, curseurs |
| `stories` | Stories, vues, audience, highlights, expiration |
| `search` | Recherche unifiée, suggestions, hashtags tendance |
| `social-notifications` | Création serveur, lecture, compteur, push |
| `moderation` | Signalements, décisions, mots bloqués, suspensions |
| `insights` | Statistiques créateur, agrégats |
| `hashtags` / `sounds` | Catalogue et compteurs |
| `admin` | Endpoints protégés par `AdminGuard` |

Endpoints principaux :

- `POST /media/uploads`, `POST /media/uploads/:id/complete`, `GET /media/uploads/:id`
- `POST/GET/PATCH/DELETE /publications`, `GET /publications/:id`
- `POST/DELETE /publications/:id/like|save|repost`, `POST /publications/:id/view`
- `GET/POST /publications/:id/comments`, `POST/DELETE /comments/:id/like`
- `GET /feed?tab=for-you|following|local&cursor=...`
- `POST/DELETE /users/:id/follow`, `GET /users/:id/followers|following`
- `GET /search?q=&type=...`, `GET /hashtags/trending`
- `POST/GET /stories`, `POST /stories/:id/view`, `GET /users/:id/stories`
- `GET /social/notifications`, `POST /social/notifications/read`
- `POST /reports`, endpoints `/admin/*`
- `GET /insights/me`

À réutiliser :

- `AuthGuard`, conventions DTO/validation et `ThrottlerGuard` existants ;
- `api/src/users/visibility.ts` (`canSee`) comme base de la politique de visibilité ;
- `api/src/push/push.service.ts` pour les notifications ;
- discipline migrations : `schema.ts` → `npm run db:generate` → relecture SQL → commit
  migration + `meta/_journal.json`.

Ajouter des rate limits par action : publication, commentaire, follow, signalement.

## 7. Pipeline médias S3/R2

1. `POST /media/uploads` : type, MIME, taille → création d'un `media_asset` `pending`
   + URL présignée.
2. Le client upload direct vers R2 (multipart pour les grosses vidéos).
3. `POST /media/uploads/:id/complete` : HEAD S3, vérification magic bytes/dimensions/durée,
   propriétaire.
4. Worker média : variantes image via `sharp`, poster et transcode H.264/AAC via `ffmpeg`,
   statut `ready`.
5. Publication avec `asset_id` uniquement si l'asset appartient à l'auteur et est prêt.

Détails :

- Bucket public + préfixe privé ; URLs publiques immuables pour le contenu public,
  URLs signées courtes pour followers/privé.
- EXIF supprimé, taille/durée maximales en constantes, quotas par utilisateur.
- Suppression logique puis purge S3/CDN ; job de nettoyage des orphelins.
- V1 : MP4 + poster, pas de HLS adaptatif ; HLS en phase ultérieure.
- Les médias chiffrés du chat restent sur le stockage local signé existant. Les deux
  pipelines ne se mélangent pas.
- Les avatars peuvent rester sur le stockage actuel en V1 ; migration ultérieure possible.
- File de jobs : table `media_jobs` avec `FOR UPDATE SKIP LOCKED`, worker séparé
  (`npm run worker:media`) pour ne pas bloquer l'API.
- Pas de Redis en V1 ; migration BullMQ/Redis si la charge l'exige.

## 8. Feed, recherche, stories, notifications

### Feed

- Classement SQL basé sur engagement pondéré, fraîcheur et affinité ;
  `hot_score` recalculé par worker.
- Trois onglets : Pour toi, Abonnements, Local.
- Local basé sur la ville existante en V1 ; geohash/rayon plus tard.
- État viewer (liked/saved/following) via `EXISTS`, pas via des tableaux dénormalisés.
- Index obligatoires : `(visibility, moderation_status, created_at)`, `(hot_score)`,
  `(author_id, created_at)`.

### Recherche

- PostgreSQL full-text (`tsvector` + GIN) et `pg_trgm` pour l'autocomplétion.
- Pas de Typesense en V1.
- Filtrer visibilité, comptes privés, blocages et modération dans la requête.

### Stories

- Expiration à 24 h, audience `everyone|followers`, exclusions, vues uniques.
- Les highlights conservent leurs assets.
- Répondre à une story crée ou réutilise une conversation directe ; le message passe par
  le chemin chat existant et contient une **référence** à la story (dans le payload chiffré
  pour l'E2EE), jamais le contenu social en clair dans le message.

### Notifications

- Création exclusivement serveur dans la même transaction que l'interaction.
- Déduplication, respect des préférences, des blocages et des quiet hours.
- Push via le service existant avec un champ `kind: social`.
- `NotificationRouter` route vers le post, la story, le profil ou la conversation.
- Éventuellement un événement Socket.IO `social:notification` pour le badge au premier plan.

## 9. Modération et back-office

- Rôles `user|moderator|admin` sur `users`, `AdminGuard`.
- Signalements utilisateur sur publications, commentaires, stories et profils.
- Auto-flag par mots bloqués et seuils de signalements ; décisions humaines dans une file.
- Actions : masquer, retirer, restaurer, avertir, suspendre ; journal d'audit.
- Suppression de compte : purge des publications, commentaires, réactions, follows,
  stories, notifications, médias S3 et signalements, en plus du flux existant à 30 jours.
- Back-office minimal `admin/` (Vite + React + TypeScript), servi par l'API à `/admin` :
  login, file de signalements, aperçu du contenu, actions, recherche utilisateur, audit.
- Pas d'admin dans l'app mobile.

## 10. Mobile : intégration

Navigation cible :

```text
app/
  (tabs)/
    index.tsx       → Feed
    discover.tsx    → Recherche / Explorer
    create.tsx      → Créer (modal)
    chats.tsx       → Messages (existant)
    profile.tsx     → Mon profil social
  post/[id].tsx
  user/[id].tsx     → profil public enrichi
  story/[id].tsx    → visionneuse
  ...               → routes chat/appels existantes conservées
```

- Créer `mobile/src/features/social/` avec `feed`, `publication`, `create`, `stories`,
  `search`, `follow`, `notifications`, `media`, `insights`.
- Réutiliser les composants existants (`avatar`, `screen`, `bottom-sheet`, `action-sheet`,
  `icon`, `themed-*`, `filter-tabs`) ; porter les composants Mbolo manquants en les
  adaptant aux tokens.
- Remplacer NativeWind par le thème maison, thèmes clair et sombre, `fr.ts` pour tous les
  libellés.
- V1 création : `expo-camera` pour photo/vidéo, galerie, recadrage image, upload avec
  progression/reprise, publication texte/photo/carrousel/reel. Pas de VisionCamera ni
  ffmpeg-kit en V1.
- Lecture : `expo-video` avec pool de players et préchargement de 2-3 éléments ;
  listes virtualisées ; images `expo-image`.
- État/offline : cache local du feed et des profils, likes/saves optimistes avec rollback,
  brouillons persistés, états chargement/vide/erreur/hors ligne.
- Authentification : conserver JWT/refresh ; ajouter un **pseudo public modifiable**
  (unicité, validation, cooldown).
- Push : un seul token par appareil (table existante), routage social et chat distinct.
- Android d'abord ; web limité à la consultation ; builds natifs via Waydroid/EAS,
  jamais de build lourd local.
- Respecter `reactCompiler` : ne pas muter une valeur passée à un hook.

## 11. Ce qu'on ne porte pas de `mbolo/`

- Firebase Auth, Firestore, Storage, Functions, Typesense client, Cloudinary, NativeWind.
- Les chemins legacy de publication (`upload.tsx`, `post.tsx`).
- Les notifications créées côté client, les compteurs/`likedBy` côté client.
- L'email dans les documents publics.
- La logique de confidentialité appliquée uniquement côté client.

On conserve :

- les specs produit et les écrans/composants comme référence UX ;
- les textes français ;
- les assets vérifiés (logo, sons, polices) sous réserve de licence.

`mbolo/` est un dépôt Git imbriqué non suivi : ne pas le committer tel quel. Le déplacer
hors du dépôt ou l'ajouter au `.gitignore` comme référence, après extraction des assets
utiles.

## 12. Feuille de route

| Phase | Durée | Contenu | Critère de sortie |
|---|---:|---|---|
| 0. Fondations | 1-2 sem | Branche, ADR, schéma v1, contrat API, spike S3/MinIO, shell navigation, mapping tokens | Schéma revu, upload présigné fonctionnel, app compile |
| 1. Socle backend | 4-5 sem | Migrations, médias, publications, interactions, follows, feed de base, recherche, notifications, reports, policy de visibilité | E2e API complet, tests de visibilité et de compteurs |
| 2. Socle mobile | 4-5 sem | Tabs, feed, détail post, profil social, follow, commentaires, réactions, recherche, notifications | Parcours complet sur appareil Android |
| 3. Création/médias | 3-4 sem | Capture, galerie, brouillons, upload, variantes/transcode, publication, lecture vidéo | Reel publié et lu sur appareil, reprises et erreurs gérées |
| 4. Découverte/stories | 3-4 sem | Classement, hashtags, recherche complète, suggestions, stories, highlights, insights de base | Ranking testé, stories expirées, confidentialité vérifiée |
| 5. Chat + modération | 3-4 sem | Partage post/story vers chat, réponses story, push social, admin, modération, purge compte | E2EE intact, file de modération opérationnelle |
| 6. Durcissement | 2-3 sem | Perf, sécurité, charge, accessibilité, offline, build release, docs | Checklist validée, beta interne |

Estimation : **20-27 semaines pour un développeur senior full-stack seul**, davantage si
le studio avancé revient tôt. Avec deux développeurs (backend/mobile) et un peu de
QA/design : **3-4 mois**.

## 13. Qualité et vérifications

À chaque phase :

```bash
cd api && npm run lint && npx tsc --noEmit && npm test
cd api && npm run test:e2e          # PostgreSQL requis
cd mobile && npx tsc --noEmit && npx expo lint && npm test
```

Tests spécifiques à ajouter :

- politique de visibilité (public, followers, privé, bloqués, compte privé) ;
- ranking et pagination du feed ;
- presign/complete média, propriété et vérification de type ;
- idempotence des publications/commentaires/réactions ;
- modération et décisions admin ;
- suppression de compte et purge S3 ;
- partage social vers chat E2EE (le serveur ne voit pas le contenu).

Tests manuels Android :

- upload et lecture vidéo ;
- scroll du feed, préchargement, mémoire ;
- notifications et routage ;
- mode sombre/clair et mise à l'échelle du texte ;
- offline, reprise et erreurs ;
- compte privé, blocage, visibilité followers.

Audit sécurité : IDOR, PII, URLs signées, rate limits, `AdminGuard`.

Le CI TypeScript étant absent, ajouter au moins un workflow API/mobile serait un vrai gain.

## 14. Risques principaux

| Risque | Impact | Mitigation |
|---|---|---|
| Scope trop large (57k LOC de référence) | Élevé | V1 stricte, phases verticales, pas de studio avancé, flags internes |
| Transcodage vidéo coûteux/complexe | Élevé | Worker Postgres, R2, MP4+poster d'abord, HLS plus tard |
| Modération insuffisante | Élevé | Admin + file + auto-flag avant ouverture, beta fermée |
| Régressions de sécurité reprises de Mbolo | Élevé | Autorisation serveur, tests, DTO publics, pas de compteurs client |
| Deux design systems | Moyen | Portage vers les tokens, inventaire de composants, pas de NativeWind |
| Dépendances natives lourdes | Moyen | `expo-camera` en V1, VisionCamera/ffmpeg différés, builds via Waydroid/EAS |
| Atteinte à l'E2EE | Élevé | Isolation stricte, aucun changement crypto, tests de non-régression |
| Présence/appels non scalables horizontalement | Moyen | Hors périmètre ; documenter, Redis/SFU plus tard |

## 15. Gouvernance de la priorité

- Ce plan prime sur les évolutions non bloquantes de `TRAVAIL-RESTANT.md`.
- Aucune ouverture publique du feed sans modération opérationnelle.
- Chaque phase se termine par ses critères de sortie, les vérifications ci-dessus et une
  revue de sécurité.
- Les décisions d'architecture sont consignées dans `docs/` (ADR) au fur et à mesure.
- Le dossier `mbolo/` reste une référence en lecture seule, jamais une dépendance de build.

## 16. Prochaines actions immédiates

1. Créer la branche de travail et l'ADR d'architecture.
2. Sortir `mbolo/` du suivi Git (déplacement hors dépôt ou `.gitignore`).
3. Écrire le schéma Drizzle v1 et le faire relire avant migration.
4. Monter le spike S3/MinIO : presign, upload, complete, génération de variantes.
5. Ajouter le shell de navigation à tabs avec écrans vides et tokens existants.
6. Démarrer la phase 1 par la politique de visibilité et les tables sociales.

## Références

- `AGENTS.md` — règles projet et vérifications.
- `docs/TRAVAIL-RESTANT.md` — backlog non prioritaire.
- `api/src/db/schema.ts` — schéma source unique.
- `api/src/users/visibility.ts` — base des règles de visibilité.
- `mobile/src/constants/theme.ts` — design tokens.
- `mobile/src/i18n/fr.ts` — libellés français.
- `mbolo/AGENTS.md` — conventions produit de l'app de référence.
