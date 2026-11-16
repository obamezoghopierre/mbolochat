import type { FollowState } from '@/lib/types';

export type FollowAction = 'follow' | 'cancel' | 'unfollow';

/**
 * Action déclenchée par le bouton d'abonnement.
 *
 * Une demande en attente se retire comme un abonnement : le serveur supprime
 * la ligne `pending`, ce qui évite de laisser une demande fantôme.
 */
export function followAction(status: FollowState['status']): FollowAction {
  if (status === 'accepted') {
    return 'unfollow';
  }
  if (status === 'pending') {
    return 'cancel';
  }
  return 'follow';
}

/** Clé de libellé (catalogue `fr.social`) correspondant à l'état. */
export function followLabelKey(
  status: FollowState['status'],
): 'follow' | 'requested' | 'unfollow' {
  if (status === 'accepted') {
    return 'unfollow';
  }
  if (status === 'pending') {
    return 'requested';
  }
  return 'follow';
}
