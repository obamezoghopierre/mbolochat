# ADR-0002 — Médias sociaux par URLs présignées

- **Statut** : accepté pour la phase 0 (spike) et la phase 1
- **Date** : 16 novembre 2026
- **Portée** : `docs/PLAN-FUSION-MBOLO.md` §7 et §16.4, tables `media_assets` / `media_jobs`

## 1. Contexte

Le social doit accepter photos et vidéos sans faire transiter les octets par l'API,
et sans que le client choisisse où il écrit. Le chat possède déjà un stockage local
signé (`api/src/media`) qui ne doit pas être mélangé : les blobs chiffrés E2EE et les
médias sociaux ont des modèles de menace différents.

Contrainte d'environnement : cette machine ne peut pas tirer l'image MinIO (registre
Docker restreint). Le spike doit donc rester vérifiable sans conteneur supplémentaire.

## 2. Décisions

1. **Module séparé** : `api/src/social-media/` (le plan l'appelle « media (social) »).
   Le dossier porte un nom distinct pour ne pas collisionner avec `api/src/media`
   (chat). Aucune ligne de code partagée entre les deux pipelines.
2. **Stockage objet compatible S3** : R2/S3 en production, MinIO en local, via
   `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Le bucket, l'endpoint et
   les identifiants viennent de `SOCIAL_S3_*` ; sans configuration, les routes
   répondent 503 sans empêcher le reste de l'API de démarrer.
3. **Flux en trois temps** :
   - `POST /media/uploads` valide type et taille, calcule la clé
     (`social/<kind>/<owner>/<uuid>.<ext>`), crée l'asset `pending` et rend une URL
     d'écriture valable 300 s ;
   - le client fait un `PUT` direct dans le stockage avec le `Content-Type` imposé ;
   - `POST /media/uploads/:id/complete` vérifie taille exacte et signature binaire,
     supprime l'objet en cas d'écart, puis passe l'asset en `uploaded`.
4. **Vérification binaire côté serveur** : le MIME déclaré ne fait que choisir les
   bornes. `detectSocialMedia` lit les premiers octets (JPEG/PNG/WebP, MP4 par
   `ftyp`, WebM par EBML). Aucun décodeur natif n'est embarqué.
5. **Plafonds nommés** : 8 Mio pour une image, 100 Mio pour une vidéo. Refus au
   ticket **et** à la confirmation, pour ne pas dépendre du client.
6. **Propriété** : un asset n'est lisible et confirmable que par son propriétaire ;
   un asset d'un autre compte répond 404, pas 403, pour ne rien divulguer.
7. **Worker média (phase 1)** : à la confirmation, un job est mis en file
   (`image_variants` pour une image, `video_poster` + `video_transcode` pour une
   vidéo). Le worker prend les jobs avec `FOR UPDATE SKIP LOCKED` et un
   `claim_token` de fencing, comme `message_events`. Une image produit des variantes
   WebP `thumb` (320) et `medium` (1080) via `sharp`, sans agrandissement ; une
   vidéo produit un poster JPEG et un MP4 H.264/AAC progressif via `ffmpeg`, avec
   durée et dimensions lues par `ffprobe`. L'asset passe en `ready` à la fin.
   Trois tentatives maximum, délai progressif, `last_error` conservé.
   Le job `cleanup` (purge des objets supprimés) reste à implémenter.

## 3. Tests

`s3rver` (dépendance **de test** uniquement) démarre un vrai serveur HTTP S3 sur un
port libre ; la suite crée le bucket, récupère l'URL présignée, envoie le `PUT` réel
puis confirme. Couverture : succès PNG et MP4, contenu usurpé (JPEG annoncé en PNG)
supprimé du stockage, taille réelle ≠ déclarée, MIME inconnu, dépassement de plafond,
asset d'autrui invisible, confirmation sans téléversement, authentification exigée.

Aucun test ne simule le stockage en mémoire : le chemin réseau et la signature d'URL
sont exercés pour de vrai.

`test/media-worker.e2e-spec.ts` va plus loin : il exécute le worker sur Postgres et
S3rver réels, avec `sharp` et `ffmpeg`. Il vérifie les octets produits (WebP « RIFF »,
JPEG, MP4 « ftyp »), l'absence d'agrandissement, la durée sondée (≈ 1 s), la reprise
d'un job en échec jusqu'à `failed` après trois tentatives (délai remis à zéro entre
les passes) et l'unicité de traitement sous deux workers concurrents.

## 4. Conséquences

- Deux dépendances de production (`@aws-sdk/client-s3`, presigner) et une de test
  (`s3rver`) ajoutées ; `npm audit --omit=dev` signale deux vulnérabilités
  **préexistantes** (`body-parser`, `multer` via NestJS), sans lien avec ce changement.
- La table `media_jobs` reste inutilisée jusqu'au worker ; l'asset doit être `ready`
  pour être attaché à une publication (règle de la phase 3).
- La suppression d'un asset passe par `deleted_at` puis purge du stockage côté worker.
- Pas de HLS : MP4 progresif en v1.

## 5. Références

- `docs/PLAN-FUSION-MBOLO.md` §7 (pipeline), §16.4 (spike).
- `docs/ADR-0001-SOCLE-SOCIAL.md` §2.6 (séparation des médias).
- `api/src/social-media/`, `api/src/common/image-signature.ts`.
- `api/test/social-media.e2e-spec.ts`.
