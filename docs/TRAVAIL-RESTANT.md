# Travail restant — MboloChat

> Backlog daté : les éléments sont traités par ordre de priorité produit.

État au 31 octobre 2026, après le commit `feat: messagerie et appels de groupe, moteur d'appel unifié`.

## 1. Vérification matérielle des appels vocaux (bloquant avant la suite)

L'audit vocal a été corrigé et couvert par des tests unitaires, mais le scénario
manuel n'a pas pu être rejoué : la session Waydroid s'est retrouvée déconnectée
après les redémarrages de l'API.

À rejouer sur **Galaxy (3 boutons et gestes)** et **Waydroid**, avec deux comptes :

- [ ] appel un à un : décroché, qualité, haut-parleur, raccrocher ;
- [ ] appel de groupe à 3 : grille, anneau de parole, quitter sans couper ;
- [ ] coupure du Wi-Fi en plein appel : « Reconnexion… » puis retour ;
- [ ] passage Wi-Fi → 4G : redémarrage ICE sans couper ;
- [ ] branchement / débranchement d'un casque filaire ;
- [ ] appel GSM entrant pendant un appel (comportement attendu ci-dessous) ;
- [ ] mode audio seul et plafond audio 8.

## 2. Corrections vocales restantes

| Réf. | Sujet | Pourquoi c'est en attente |
|---|---|---|
| C1 | Interruption GSM / perte de focus audio : pause affichée « Audio interrompu » | Nécessite un callback natif de focus audio (`AudioManager`) — lot natif |
| C8 | Détection de changement de réseau → redémarrage ICE immédiat | `@react-native-community/netinfo` est un module natif — lot natif |
| C9 | Écoute des pistes distantes `mute`/`ended` (micro distant perdu) | JS seul, petit chantier, non commencé |
| C10 | Suivi des changements de route casque / Bluetooth | L'événement `WiredHeadset` d'InCallManager n'est pas encore branché |

Le verrou d'écran (`expo-keep-awake`) est en place ; le capteur de proximité
éteint l'écran à l'oreille comme prévu.

## 3. Tranche 6 — persistance des appels

- [ ] migration `0024_call_sessions.sql` : `call_sessions` + `call_participants`
      (mode, média, état, démarré par, début/fin, durée ; arrivée/départ par
      participant) ;
- [ ] `calls.repository.ts` en écriture **fire-and-forget**, partagé par
      `CallsService` et `GroupCallsService` ;
- [ ] tests e2e : un appel de groupe laisse la session et ses participants en base ;
- [ ] vérification du message système final (`Appel terminé · durée`) après
      redémarrage du serveur en cours d'appel.

## 4. Tranche 7 — lot natif (un seul rebuild EAS, à lancer par Bruneel)

- [ ] service de premier plan Android (`MICROPHONE` / `PHONE_CALL`) avec
      notification permanente « Appel en cours » et bouton raccrocher ;
- [ ] appel entrant groupe : notification plein écran pour les groupes (le push
      actuel ne concerne que le 1:1) ;
- [ ] `@react-native-community/netinfo` (C8) ;
- [ ] `expo-screen-orientation` : paysage géré sans couper l'appel ;
- [ ] callback de focus audio natif (C1).

Après rebuild : réinstaller l'APK sur les deux appareils et rejouer la section 1.

## 5. Vidéo de groupe — points différés

- [ ] coupure automatique des vidéos hors écran (sans objet tant que le plafond
      est à 4 participants ; à brancher avec le SFU) ;
- [ ] préparation SFU : le moteur ne connaît que `send(event, { to })`, la porte
      est ouverte mais rien n'est implémenté.

## 6. Qualité de code et finition

- [ ] **dette lint préexistante** : 32 erreurs hors périmètre appel
      (`chats.tsx` 3, `ChatComposer` 10, `swipeable-row` 4, scripts 17) ;
- [ ] i18n : fichier de chaînes français et extraction des textes ;
- [ ] nettoyage des couleurs/tailles codées en dur restantes hors écrans d'appel ;
- [ ] accessibilité des écrans de groupe (libellés, ordre de focus) ;
- [ ] scénario de bout en bout : créer un groupe de 3, envoyer un message,
      ajouter un membre, quitter.

## 7. Sessions et incidents observés

- [ ] **Déconnexion involontaire** : Waydroid s'est retrouvé sur l'écran de
      connexion après des redémarrages d'API. À vérifier : l'app ne doit pas
      effacer les jetons sur une simple erreur réseau (`auth-context`).
- [ ] Purge optionnelle des comptes de test (`*@smoke.dev`, `*@e2e.dev`) et des
      groupes de test restants.

## 8. Publication façon Instagram — reste à vérifier

Le flux « Créer » est en place côté code : sélecteur de photothèque
(`app/create/index.tsx`), caméra et enregistrement (`app/create/camera.tsx`),
compositeur texte (`app/create/text.tsx`), aperçu + filtres + audience
(`app/create/preview.tsx`), catalogue de filtres partagé
(`features/media/media-filter.tsx`, parité verrouillée par
`mobile/tests/mediaFilters.test.mjs`) et colonne `publications.media_filter`
(migration `0049`).

- [ ] **rebuild APK obligatoire** : le plugin `expo-media-library` ajouté à
      `app.json` change les permissions Android ; sans build, la grille
      « Récentes » reste vide et le repli photothèque s'ouvre ;
- [ ] vérifier sur appareil : sélection photo multiple (carrousel), vidéo
      seule, caméra + flash + bascule, filtres (rendu identique aperçu → fil),
      publication puis apparition dans le fil ;
- [ ] Android < 10 : `mixBlendMode` est inopérant, les filtres retombent sur
      les voiles de `fallback` — confirmer que « Chrome » et « Noir » restent
      lisibles ;
- [ ] vignettes : grille de republications, carte de partage en discussion et
      citation affichent le filtre ; vérifier le rendu des coins arrondis.

### Compositeur texte (refonte façon Instagram)

- [x] carte 4:5 plein écran, une page à la fois, glissement horizontal, points
      de pagination, « + » flottant, suppression par page ;
- [x] police auto-ajustée à la longueur du texte (`features/social/create/text-card.ts`,
      couvert par `text-card.test.ts`) ;
- [x] brouillon persistant (AsyncStorage optionnel, `lib/text-draft.ts`) ;
- [x] compteur et rappel de la troncature à 320 caractères du fil ;
- [x] polices et alignement persistés (`text_font`, `text_align`, migration
      `0050` + rendu dans `text-page.tsx` et `text-post-reader.tsx`) ;
- [x] palette élargie (20 fonds au total) et couleur de texte persistée
      (`text_color`, migration `0051`, 9 teintes + « auto »), parité verrouillée
      par `tests/textBackgrounds.test.mjs` (fonds, polices, alignements,
      couleurs) ;
- [x] autocomplétion `@` (comptes via `/search`) et `#` (hashtags, tendances
      à requête vide) dans le compositeur ;
- [x] aperçu avant publication : « Suivant » ouvre un mode aperçu avec le
      dégradé réel du fil (`TextPostBackdrop`), « Publier » enchaîne ;
- [x] titre dédié (`text_title`, migration `0052`), titre ≤ 200 car. ;
- [x] taille de police manuelle 16–64 pt (`text_size`, migration `0053`,
      `null` = auto-ajustement), rendue dans la carte, les pages et le lecteur ;
- [x] localisation facultative (`location`, migration `0054`, ≤ 100 car.,
      saisie libre + GPS via `GET /users/geo/reverse`, coordonnées non
      conservées) affichée avec une épingle dans le fil ;
- [x] plusieurs brouillons (`mbolo:text-drafts:v1`, liste ≤ 10, expiration
      7 j, migration de l'ancien format `mbolo:text-draft:v1`, feuille de
      sélection `DraftsSheet`, seul le brouillon actif est effacé à la
      publication) ;
- [x] édition après publication (`PATCH /publications/:id`, auteur seul,
      re-scan modération, resynchronisation légende ↔ page 1) ;
- [x] aperçu de lien (`publications.link_preview`, migration `0055`, JSONB) :
      première URL du texte fetchée côté serveur (OG/Twitter, SSRF filtré,
      redirections revalidées, corps borné 512 Kio, délai 5 s, cache 10 min),
      carte lien cliquable dans le fil, URLs soulignées cliquables ;
- [x] règle « post long = fond normal » (`isShortTextPost`, seuils partagés
      160/320), 26 fonds et 16 couleurs de texte ;
- [ ] sur appareil : vérifier que le clavier ne rogne pas la carte sur un écran
      court (l'`overflow` du pager masque le débordement mais rien n'est mesuré),
      le rendu des polices système (`serif`/`monospace`/`Courier`/`Georgia`),
      les suggestions `@`/`#` en conditions réelles, le contrôle de taille de
      police, le tag GPS (`expo-location`, build natif requis) et la carte
      d'aperçu de lien ;
- [ ] reste à vérifier : la publication conserve bien police/alignement/fond
      à l'affichage dans le fil (les anciens posts restent centrés/classiques).

## 9. Pour reprendre

```bash
# API (actuellement arrêtée)
cd api && setsid node dist/main > /tmp/mbolochat-api.log 2>&1 < /dev/null &

# Mobile
cd mobile && npx expo start --dev-client

# Tunnels des appareils (après redémarrage d'adb)
adb -s <appareil> reverse tcp:8081 tcp:8081
adb -s <appareil> reverse tcp:3001 tcp:3001

# Vérifications
cd api && npm run lint && npm run build && npm run test:e2e
cd mobile && npx tsc --noEmit && npm test && npx expo lint
```
