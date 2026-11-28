/**
 * Libellés de l'onglet Découvrir (mosaïque Explorer + recherche).
 * Les textes de recherche générique restent dans `fr.ts` (`social.discover*`).
 */
export const discoverFr = {
  /** Ferme le champ de recherche et revient à la grille. */
  clearSearch: 'Effacer la recherche',
  /** Quitte la recherche et rend la mosaïque, comme « Annuler » sur Instagram. */
  cancel: 'Annuler',
  retry: 'Réessayer',
  sectionError: 'Impossible de charger la suite. Réessaie.',
  offline: 'Hors ligne — la grille ne peut pas être actualisée.',
  errorTitle: 'Découvrir est indisponible',
  errorBody: 'Vérifie ta connexion, puis réessaie.',
  emptyAllTitle: 'Rien à découvrir pour le moment',
  emptyAllBody: 'Reviens plus tard : de nouvelles publications arriveront.',
  /** Ouvre l'onglet d'un type de résultat depuis son aperçu. */
  seeAll: 'Voir tout',
  /** Aucun résultat : ce qu'il reste à essayer. */
  noResultsBody: 'Essaie un autre mot, un pseudo ou un #hashtag.',
  /** Échecs réseau ou serveur, affichés dans la notification de l'écran. */
  sectionLoadFailed: 'Impossible de charger la grille. Vérifie ta connexion.',
  sectionInvalid: 'Réponse de la grille invalide. Réessaie.',
  reactFailed: 'Réaction non enregistrée. Vérifie ta connexion.',
  reactRemoveFailed: 'Réaction retirée impossible. Vérifie ta connexion.',
  saveFailed: 'Enregistrement impossible. Vérifie ta connexion.',
  repostFailed: 'Republication impossible. Vérifie ta connexion.',
  followFailed: 'Abonnement impossible. Vérifie ta connexion.',
  unfollowFailed: 'Désabonnement impossible. Réessaie.',
  deleteFailed: 'Suppression impossible.',
  dismissFailed: 'Impossible de masquer cette publication.',
  muteAuthorFailed: 'Impossible de masquer cet auteur.',
} as const;
