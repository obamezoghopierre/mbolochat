import { useSyncExternalStore } from 'react';

/**
 * La page de fil visible est-elle un post texte rendu clair ?
 *
 * En thème clair, la carte texte a un dégradé pastel : les icônes blanches de
 * la barre d'onglets transparente deviennent illisibles. Le pager publie cet
 * état ici et `CustomTabBar` l'utilise pour passer aux teintes foncées — sans
 * prop drilling à travers le navigateur d'onglets.
 */
let lightPage = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setFeedPageIsLight(value: boolean): void {
  if (value === lightPage) {
    return;
  }
  lightPage = value;
  listeners.forEach((listener) => listener());
}

export function useFeedPageIsLight(): boolean {
  return useSyncExternalStore(subscribe, () => lightPage);
}
