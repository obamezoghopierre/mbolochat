# Audit — feed vidéo façon TikTok

- **Portée** : lecture plein écran du fil (`mobile/src/features/social/feed/**`) et chaîne backend
  associée (`api/src/feed`, `api/src/publications`, `api/src/social-media`).
- **Rattachement** : `docs/PLAN-FUSION-MBOLO.md` phases 2 (socle mobile), 3 (création/médias),
  4 (découverte/classement) et 6 (durcissement).
- **Nature** : audit initial, puis journal des corrections appliquées (§9).
- **Verdict** : la coquille visuelle est proche de TikTok ; le moteur ne l'est pas. Les manques
  décisifs sont la **consommation (vues, durée de visionnage)**, le **classement**, la
  **confidentialité des médias** et la **gestion du cycle de vie des lecteurs**.

## 0. Vérifications exécutées

| Commande | Résultat |
| --- | --- |
| `cd mobile && npx vitest run src/features/social/feed/feed-model.test.ts src/features/social/feed/pager/feed-media.test.ts` | 15 tests OK |
| `cd mobile && npx tsc --noEmit` | **échec** : 5 erreurs de routes typées (`/discover`, `/create`, `/post/${id}`) |
| `cd api && npx tsc --noEmit` | **échec** : `sharp` et `@aws-sdk/*` absents (dépendances non installées) |
| `cd api && npx vitest run src/users/social-visibility.spec.ts test/public-user.spec.ts` | 21 tests OK |
| `vitest run … e2e` (feed, worker média, publication-media) | non exécuté (PostgreSQL requis) |
| Test sur appareil (lecture, scroll, audio) | non exécuté — aucune conclusion « validé » sans cet essai |

Les deux erreurs `tsc` sont des préalables, pas des défauts du feed : régénérer les types
`expo-router` (`npx expo start` une fois) et lancer `npm install` dans `api/`.

---

## P0 — bloquants avant de parler de « niveau TikTok »

### P0.1 La vidéo continue de jouer quand on quitte le fil

`FeedPager` ne connaît que la visibilité dans la liste : `chrome.isActive = index === activeIndex`
(`feed-pager.tsx:238`). Aucun écran ne consulte le focus d'onglet (`useIsFocused`/`useFocusEffect`)
ni le blur de navigation, et `Tabs` garde les écrans montés. Changer d'onglet ou ouvrir
`/post/:id` laisse donc le son du fil tourner dessous.

**Correction** : exposer `focused` (onglet + `AppState`) et l'injecter dans `VideoPage` ;
pause immédiate si `!focused || state !== 'active'`, reprise seulement au retour sur la page active.

### P0.2 Le cache disque annoncé n'existe pas

Le commentaire de `video-page.tsx:79-81` affirme un cache de 200 Mo, mais :
`useVideoPlayer(url, …)` (`video-page.tsx:82-90`) ne passe jamais `useCaching`, et
`VIDEO_CACHE_BYTES` (`feed-pager.tsx:51`) n'est **référencé nulle part**. `useCaching` vaut
`false` par défaut et le cache par défaut d'`expo-video` est de 1 Gio : chaque swipe re-télécharge.

**Correction** : `useVideoPlayer({ uri: url, useCaching: true }, …)` et un
`setVideoCacheSizeAsync(VIDEO_CACHE_BYTES)` unique au démarrage de l'app.

### P0.3 Aucun état d'erreur vidéo

`showPoster = status !== 'readyToPlay'` (`video-page.tsx:151`) couvre chargement et échec de la
même façon : source absente, 403 CDN, variante non prête ou codec refusé donnent un écran noir
silencieux, sans message ni relance. Le cas `url === null` (asset sans variante ni base publique)
n'est pas traité du tout.

**Correction** : trois états explicites (chargement / erreur / prêt), bouton « Réessayer »,
`onFirstFrameRender` pour retirer le poster, et repli serveur garanti (voir P0.4).

### P0.4 Confidentialité des médias contournée par l'URL publique

`mediaView` (`publication-media.ts:52-82`) construit une URL **publique** à partir de
`SOCIAL_S3_PUBLIC_BASE_URL` pour tout asset `ready`, quelle que soit la visibilité de la
publication, son statut de modération ou sa suppression logique. Une publication `followers`,
`flagged`, `removed` ou supprimée reste donc lisible par son URL (non devinable, mais partageable
et non révocable). Cela contredit le plan §4.4/§4.6 et l'ADR-0002 §2.5.

**Correction** : `mediaView` reçoit la visibilité effective ; URL publique uniquement pour
`public` + `approved`/`pending` + non supprimée, sinon URL signée courte (TTL minutes) calculée
côté serveur. Jamais de clé S3 renvoyée au client.

### P0.5 Les comptes privés fuient par le fil

`visiblePublicationConditions` (`social/publication-visibility.ts:15-40`) filtre la visibilité de
la publication, les blocages, la modération et `deleted_at`, mais **pas** `users.private_account`.
Une publication `public` d'un compte privé apparaît donc dans Pour toi et Local à tout le monde,
alors que le profil est fermé. `canViewProfile` existe mais n'est pas utilisé là.

**Correction** : ajouter à la clause `and(not(users.privateAccount) or followsAuthor or author = viewer)`,
et exclure `users.deleted_at` (compte en cours de suppression, `schema.ts:114`).

### P0.6 La suppression d'une publication ne retire aucun média

`PublicationsService.remove` ne pose que `deletedAt` (`publications.service.ts:238`) ; aucun job
`cleanup` n'est créé et `MediaWorkerService.process` lève sur tout `kind` inconnu
(`media-worker.service.ts:176`) — le type `cleanup` est déclaré mais non implémenté (ADR-0002 §2.7).
Les octets restent sur S3/CDN, y compris pour un contenu retiré par la modération.

**Correction** : job `cleanup` (variantes + original + poster), appelé par la suppression auteur
et la décision `remove` de modération. Un asset encore référencé par un contenu vivant n'est pas
purgé (média partagé par deux publications). Voir §9.

---

## P1 — performance et qualité de lecture

### P1.1 20 re-rendus React par seconde sur la page active

`timeUpdateEventInterval = 0.05` (`video-page.tsx:89`) combiné à
`useEvent(player, 'timeUpdate', …)` dans `ProgressBar` (`progress-bar.tsx`) déclenche un rendu du
sous-arbre à chaque tick, alors que toute la géométrie est déjà en valeurs partagées Reanimated.

**Correction** : `0.25 s` en lecture normale, `0.05 s` seulement pendant le scrub, et
`useEventListener` (sans état React) alimentant les valeurs partagées.

### P1.2 Cinq lecteurs natifs montés en permanence

`windowSize={5}` (`feed-pager.tsx:227`) garde jusqu'à cinq `VideoView`/ExoPlayer vivants
(`textureView`). Sur Android, chaque player conserve décodeur et surface : pression mémoire et
démarrages lents.

**Correction** : pool de 3 (actif + précédent + suivant), préchargement conditionné à
`status === 'readyToPlay'` du courant, libération explicite au-delà de `|distance| > 1`.
`distance` et `activeIndex` sont déjà dans `FeedPageChrome` (`video-page.tsx:27-29`) mais **jamais
lus** : soit ils servent au préchargement, soit ils disparaissent.

### P1.3 Seek de reprise non annulé au démontage

`resumeAfterSeek` programme `setTimeout(() => player.play(), 60)` (`video-page.tsx:233-241`) sans
nettoyage : sur une page recyclée, `play()` peut viser un player libéré.

**Correction** : mémoriser l'identifiant du timer et l'annuler dans le nettoyage de l'effet.

### P1.4 Transcodage non adapté au mobile

`processVideo` « transcode » sans changer l'échelle (`media-processors.ts:145-166`) : une source
4K reste en 4K, avec `-crf 23 -preset veryfast` et sans plafond de débit ni GOP court. Résultat :
poids réseau élevé, seek imprécis, démarrage lent.

**Correction** : `-vf scale='min(1080,iw)':-2` (portrait : hauteur 1920), paliers
540p/720p/1080p avec débit cible, `-g 30 -keyint_min 30 -sc_threshold 0` pour un seek par keyframe,
`+faststart` conservé, puis HLS (plan §7 phase 4) pour l'adaptatif.

### P1.5 Worker : RAM et verrouillage

- `storage.download()` renvoie **tout** l'objet en mémoire (`object-storage.service.ts:98-108`) :
  100 Mio × 2 jobs × N workers.
- Le timeout ffmpeg est fixe à 120 s (`media-processors.ts:21`) quel que soit la durée source.
- `process()` lit `asset.variants`, puis écrit la fusion (`media-worker.service.ts:150-175`) sans
  verrou : deux workers peuvent perdre une variante (poster ou mp4).
- `status = 'ready'` est posé par le transcodage seul : si le poster échoue définitivement, l'asset
  est `ready` sans image de couverture.

**Correction** : streaming S3 → fichier temporaire, timeout proportionnel à la durée,
`SELECT … FOR UPDATE` sur `media_assets` (fusion des variantes sous verrou), et `ready` dès que le
MP4 existe — le poster reste un confort de chargement, il ne doit pas bloquer une publication.

### P1.6 Absence de gestion réseau

`expo-network` est déjà une dépendance mais le feed l'ignore : préchargement en 4G, pas de mode
économie de données, pas de message hors ligne, pas de reprise après coupure.

**Correction** : désactiver le préchargement et le poster distant en cellulaire par défaut,
afficher un état hors ligne explicite (règle UI §5).

---

## P2 — classement : ce qui manque pour égaler TikTok

### P2.1 Le score ne décroît jamais

`hot_score` est calculé à la création (`publications.service.ts:179`) et à chaque interaction
(`:786`). Aucun worker périodique ne le recalcule, contrairement au commentaire de
`hot-score.ts:8-13`. Une publication sans interaction garde donc son score initial à vie :
le fil est en pratique trié par **engagement cumulé**, pas par fraîcheur.

**Correction** : worker de recalcul (fenêtre 7 jours, lots de quelques milliers, toutes les 5 min),
ou tri SQL sur une formule bornée + curseur `(created_at, id)`.

### P2.2 Aucun signal de consommation

La table `publication_views` existe (`schema.ts:1233`) mais **n'est jamais écrite** : pas de
`POST /publications/:id/view`, pas de durée de visionnage, pas de taux de complétion, pas de
dé-duplication des vues, `counters.views` reste à 0. C'est le socle du classement TikTok.

**Correction** : endpoint idempotent `{ positionMs, durationMs, completed }` (upsert PK
`(publication_id, user_id)` + colonnes `watch_ms`, `completion_rate`), agrégats par publication,
exclusion des contenus déjà vus dans Pour toi, affichage du compteur de vues.

### P2.3 « Pour toi » n'est pas personnalisé

`FeedService.list` (`feed.service.ts:88-175`) exécute la même requête pour les trois onglets, seule
la clause `followsAuthor` ou `ville` change, et l'ordre est toujours `hot_score`.

**Correction** (phase 4) : affinité (auteurs consultés, hashtags likés, sons), boost de fraîcheur,
pénalité de vue récente, diversité d'auteur (max 2 par page), part d'exploration hors graphe,
tremplin pour les petits créateurs.

### P2.4 Pas de signal négatif

Aucune action « Pas intéressé / Masquer cet auteur / Ne plus voir ce son » : le fil ne peut pas
apprendre d'un rejet, seul le signalement existe (lourd, modération).

### P2.5 Pas de filtre de format

Le pager plein écran sert aussi les posts texte (`TextPage`) et les carrousels (`ImagePage`), et
`/feed` n'accepte ni `kind` ni `format`. Un feed vidéo doit pouvoir demander uniquement
`format=video` / `kind=reel`.

### P2.6 Abonnements et Local mal triés

`tab=following` trie encore par `hot_score` (TikTok et tous les concurrents : chronologique), et
`local` ne varie que par `users.city`, sans affinité ni rayon.

### P2.7 `hot_score` peut déborder

`hot_score` est un `integer` (`schema.ts:1074`, max 2 147 483 647) et la formule multiplie par
`1e6` : un contenu viral très jeune (> ~17 000 d'engagement pondéré à 2 h) dépasse la borne →
erreur SQL à l'écriture du score. Passer en `bigint`/`numeric`, ou borner le score.

### P2.8 Curseur instable sous interaction

Le curseur porte sur `(hot_score, id)`, mais `hot_score` change quand un like arrive entre deux
pages : doublons ou sauts possibles. Une session de feed (snapshot d'IDs côté serveur, TTL court)
rend la pagination stable.

### P2.9 Index et coût de requête

Seul `publications_hot_score_idx` existe (`schema.ts:1099`). Le `WHERE` combine visibilité,
modération, `deleted_at`, blocages (`NOT EXISTS`) et abonnements (`EXISTS`), plus trois `LEFT JOIN`
d'état visiteur : l'index simple ne couvre pas le tri filtré. Ajouter un index partiel
`(hot_score DESC) WHERE deleted_at IS NULL AND moderation_status IN ('pending','approved')` et
`(visibility, hot_score DESC)` ; mesurer avec `EXPLAIN` sur un volume réaliste.

### P2.10 Rate limit absent sur les actions de feed

Le plan §6 demande des limites par action ; seul le `AppThrottlerGuard` global existe. À cadrer
pour `/feed`, `/publications/:id/view`, `/like`.

---

## P3 — finitions UX, accessibilité, dette

| # | Constat | Correction |
| --- | --- | --- |
| P3.1 | Gestes limités : tap, double-tap, appui long. Pas de scrub horizontal, pas d'haptique (`expo-haptics` déjà présent), cœur de double-tap toujours centré (`HeartBurstOverlay`) | scrub horizontal avec précision, `Haptics.impactAsync` sur like/seek, cœur positionné au point touché |
| P3.2 | Une seule réaction possible depuis l'UI (`like`), alors que l'API accepte `like\|love\|fire\|clap` | appui long sur le cœur → sélecteur de réaction |
| P3.3 | `allowFontScaling={false}` sur les onglets du fil (`feed-screen.tsx:141`) | retirer, laisser la mise à l'échelle système (règle accessibilité §6) |
| P3.4 | `refreshing` et `hasMore` renvoyés par `useFeed` mais inutilisés ; pas de pull-to-refresh ni d'état « fin du fil » | câbler `RefreshControl` et un pied de liste explicite |
| P3.5 | Ligne « Son original » statique (`post-info.tsx`) alors que `sounds`/`soundId` existent en base et ne remontent pas dans le DTO | exposer le son dans `PublicationView` et le lier à une page son |
| P3.6 | Actions concurrentes : `useFeed` capture `items` avant l'appel ; deux actions rapides peuvent restaurer un état obsolète | rollback par identifiant ou `setItems(current => …)` |
| P3.7 | `deepLink()` dupliqué, schéma `mbolochat://` en dur dans deux fichiers | centraliser dans `mobile/src/lib/` |
| P3.8 | Aucun test du pager ni du chemin vidéo (Vitest ne monte pas RN), et aucun e2e `/feed` avec une vraie vidéo transcodée | tests unitaires de la logique de pager (distance, plafond de pool), e2e « publier une vidéo → la retrouver dans `/feed` avec poster + mp4 », essai appareil documenté |

---

## Séquence de travail proposée

1. **Correctifs P0** (1 semaine, phase 2/3) — cycle de vie du lecteur, cache, états d'erreur,
   confidentialité des médias, comptes privés, purge.
2. **Perf P1** (1 semaine) — pool de lecteurs, télémétrie de progression sans re-rendu, pipeline
   de transcodage adapté, réseau.
3. **Consommation + classement P2** (2-3 semaines, phase 4) — `/view`, agrégats, worker de score,
   personnalisation, diversité, filtres de format, index, rate limits.
4. **Finitions P3** (1 semaine) — gestes, réactions, accessibilité, états de liste, tests.

## Critères de sortie

- Quitter le fil ou l'app coupe le son et libère les lecteurs ; revenir reprend là où on s'était arrêté.
- Une vidéo déjà vue se relit sans réseau (cache vérifié sur appareil).
- Aucune URL de média non public ne reste accessible après retrait ou suppression.
- Un compte privé n'expose rien dans Pour toi ni Local (test e2e).
- Le classement bouge sans interaction (recalcul périodique vérifié) et réagit à la durée de visionnage.
- `npx tsc --noEmit` (api, mobile), `npm test` (api, mobile) et `npm run test:e2e` (api) passent.

---

## 9. État après implémentation

Deux passes : correctifs P0/P1, puis classement et finitions.

| Commande | Résultat |
| --- | --- |
| `cd api && npx tsc --noEmit` | OK |
| `cd api && npm run lint` | OK |
| `cd api && npm test` | 153 tests OK |
| `cd api && npm run test:e2e` | 209 OK, 1 ignoré, **2 échecs `spawn ffmpeg ENOENT`** (fixtures vidéo, ffmpeg absent de la machine) ; un échec isolé de `message-events` (effets push, 502 réseau) repasse seul à 20/20 → interférence de charge, sans lien avec le fil |
| `cd mobile && npx tsc --noEmit` | OK |
| `cd mobile && npx expo lint` | OK |
| `cd mobile && npm test` | 701 tests OK |
| Essai sur appareil Android | **non fait** — aucune conclusion « validée » sans cet essai |

### Corrigé

| Réf. | Correction | Où |
| --- | --- | --- |
| P0.1 | Le fil se tait hors onglet et en arrière-plan (`playbackActive`) | `feed-screen.tsx`, `feed-pager.tsx`, `video-page.tsx` |
| P0.2 | Cache réellement activé (`useCaching` + `setVideoCacheSizeAsync`) | `video-page.tsx`, `feed-pager.tsx` |
| P0.3 | États vidéo explicites + relance + poster retiré sur première image | `video-page.tsx` |
| P0.4 | URL publique réservée au contenu public, sinon URL signée (TTL 10 min) | `publication-media.ts`, `object-storage.service.ts`, `users/visibility.ts` |
| P0.5 | Comptes privés et supprimés filtrés en SQL **et** dans le détail (404) | `publication-visibility.ts`, `publications.service.ts` |
| P0.6 | Job `cleanup` (original, variantes, poster), sans purger un asset encore référencé | `media-cleanup.ts`, `media-worker.service.ts` |
| P1.1 | Plus de re-rendu par `timeUpdate` ; cadence 0,25 s / 0,05 s en scrub | `progress-bar.tsx` |
| P1.2 | 3 lecteurs au plus, voisines non montées au-delà | `feed-pager.tsx`, `preload.ts` |
| P1.3 | Timer de reprise annulé au démontage | `video-page.tsx` |
| P1.4 | Transcodage : 1080 max, `yuv420p`, GOP 30 | `media-processors.ts` |
| P1.5 | Streaming S3 → fichier, timeout proportionnel, variantes sous `FOR UPDATE` | `object-storage.service.ts`, `media-worker.service.ts` |
| P1.6 | Économie de données : pas de préchargement de la voisine en cellulaire (poster seul) ; bandeau hors ligne | `feed-pager.tsx`, `feed-screen.tsx` |
| P2.1 | Recalcul périodique de `hot_score` (seuil de dérive 0,5 %) | `ranking/`, `worker-media.ts` |
| P2.2 | Vues + durée de visionnage idempotentes (`/view`), compteur et poids de portée | migration `0040_feed_video`, `publications.service.ts`, `view-tracker.tsx` |
| P2.3 | « Pour toi » personnalisé : affinité (abonnement, réaction/commentaire récents sur l'auteur), part d'exploration hors graphe, diversité d'auteurs (max 2 consécutifs), exclusion des contenus vus depuis 24 h | `feed.service.ts`, `feed-ranking.ts` |
| P2.4 | Signaux négatifs : `POST /feedback` (`publication` \| `author`), suppression, filtrage SQL dans tous les onglets ; menu « Pas intéressé » / « Masquer cet auteur » | `feedback/`, `feed.service.ts`, `feed-pager.tsx`, `use-feed.ts` |
| P2.5 | Filtre `?format=` sur `/feed` | `feed.controller.ts` |
| P2.6 | Onglet Abonnements **chronologique** (`created_at`, `id`), au lieu du score | `feed.service.ts` |
| P2.7 | Score borné, plus de débordement `integer` | `hot-score.ts` |
| P2.8 | Sessions de fil : ordre figé, curseur = décalage, pages recollées si un contenu disparaît, purge des sessions expirées | migration `0041_feed_sessions`, `feed.service.ts`, `feed-ranking.ts`, `ranking.service.ts` |
| P2.9 | Index partiels du fil | migrations `0040`, `0041` |
| P2.10 | Rate limits par action : `/feed` 120/min, like 120/min, vue 600/min, feedback 60/min | `feed.controller.ts`, `publications.controller.ts`, `feedback.controller.ts` |
| P3.1 | Cœur du double-tap au point touché + retour haptique | `heart-burst.tsx`, `feed-gestures.tsx`, `feed-pager.tsx` |
| P3.2 | Sélecteur de réaction (appui long sur le cœur) avec réaction courante marquée | `action-rail.tsx`, `action-sheet.tsx`, `feed-pager.tsx` |
| P3.3 | `allowFontScaling` rétabli sur les onglets | `feed-screen.tsx` |
| P3.4 | Pull-to-refresh + état « Tu es à jour » en fin de fil | `feed-pager.tsx`, `feed-screen.tsx` |
| P3.6 | Rollback ciblé, réinsertion à la bonne place | `use-feed.ts` |
| P3.7 | Lien profond centralisé dans `lib/deep-link.ts` | `deep-link.ts`, `feed-pager.tsx` |
| P3.8 | Logique de pager testée sans rendu (activité, montage des lecteurs) | `preload.test.ts`, `feed-ranking.spec.ts` |

### Incident : conflit lecteur / vue native au scroll (corrigé)

Symptôme : `Cannot set prop 'player' on view …TextureVideoView` →
`IllegalStateException: The player has been notified of disconnection from the
player view, even though it's still connected`, en passant à la vidéo suivante.

Cause : plusieurs `VideoView` montées en même temps pour un même lecteur (ou une
`VideoView` native détachée par le recyclage de la liste alors que son lecteur
restait rattaché). Côté natif, le setter `VideoView.videoPlayer` lève dès qu'un
lecteur encore connecté à une vue reçoit une autre vue, et `hasBeenDisconnectedFromVideoView`
lève quand la vue courante n'a pas été libérée.

Correctifs (invariants désormais structurels) :

| Règle | Mise en œuvre |
| --- | --- |
| Une seule `VideoView` vivante | seule la page **active** monte `VideoPage` ; les voisines n'ont aucune vue (`videoPageMode`) |
| La prop `player` d'une vue montée ne change jamais | clé de vue `${post.id}-${viewEpoch}` : un lecteur recréé par `expo-video` remonte la vue au lieu de réaffecter la prop |
| Aucune vue détachée par la liste | `removeClippedSubviews={false}` explicite (actif par défaut sur Android) |
| Préchargement sans conflit | `VideoPrefetch` : lecteur détaché, sans `VideoView`, qui ne fait que remplir le cache disque |
| Pas de double libération | cycle de vie entièrement confié à `useVideoPlayer`, aucun `release()` manuel |
| Même URL pour les deux lecteurs | `video-source.ts`, partagé par la page active et le préchargement |

Vérification statique : `tsc` OK, `expo lint` OK, 702 tests mobiles OK
(dont `preload.test.ts` : une seule page en mode `play`, voisines en `prefetch`
ou `poster`).

Vérification sur appareil : **non réalisée**. Waydroid démarre ici sans service
`waydroidplatform` exploitable, sans root et sans route ADB vers le conteneur,
et aucun APK n'y est installé : la passe de scroll réelle reste à faire.

### Restant

| Réf. | Reste à faire | Pourquoi |
| --- | --- | --- |
| P3.1 | Scrub horizontal du feed (avancer/reculer en glissant) | conflit de gestes à régler sur appareil |
| P3.5 | Son réel dans le DTO (`sounds`) | le studio de création (phase 3) ne renseigne pas encore `soundId` : l'exposer maintenant serait du code mort |
| — | Écran de réglages « contenus écartés » (l'API `GET /feedback` existe) | hors périmètre du fil |
| — | HLS adaptatif et paliers de débit multiples | phase 4 du plan, dépend du worker |
| — | Rate limits ajustés sur données réelles | valeurs de départ à confronter au trafic |
| P3.8 | Essai appareil : lecture, mémoire, audio, gestes, mode sombre | aucune validation matérielle possible dans cet environnement |

### Écarts assumés

- **P1.5** : `ready` dès que le MP4 existe ; le poster reste un confort, il ne bloque pas la
  publication.
- **P2.1** : recalcul seulement au-delà de 0,5 % de dérive, sinon chaque passe réécrivait toute
  la fenêtre (le score décroît en continu).
- **P2.6** : l'onglet Local reste classé (score × affinité) et non chronologique : c'est un fil
  de découverte de proximité, pas un fil d'abonnements.
- **P2.8** : une session expirée (30 min) répond 400 « Session de fil expirée ». Le client
  affiche déjà l'état d'erreur avec relance ; un renouvellement transparent pourra être ajouté.
