import { describe, expect, it } from 'vitest';

import {
  canInteract,
  canViewProfile,
  canViewPublication,
  isPubliclyCacheable,
  type SocialPublicationFacts,
  type SocialViewer,
} from './visibility.js';

const AUTHOR = 'auteur';

function viewer(overrides: Partial<SocialViewer> = {}): SocialViewer {
  return {
    viewerId: 'visiteur',
    isFollower: false,
    isFollowedBy: false,
    blocked: false,
    ...overrides,
  };
}

function publication(overrides: Partial<SocialPublicationFacts> = {}): SocialPublicationFacts {
  return {
    authorId: AUTHOR,
    visibility: 'public',
    moderationStatus: 'approved',
    deleted: false,
    ...overrides,
  };
}

describe('canViewPublication', () => {
  it('une publication publique est visible par un inconnu non bloqué', () => {
    expect(canViewPublication(publication(), viewer())).toBe(true);
  });

  it('« followers » exige un abonnement accepté', () => {
    const facts = publication({ visibility: 'followers' });
    expect(canViewPublication(facts, viewer({ isFollower: true }))).toBe(true);
    expect(canViewPublication(facts, viewer())).toBe(false);
  });

  it('« private » n’est visible que par l’auteur', () => {
    const facts = publication({ visibility: 'private' });
    expect(canViewPublication(facts, viewer({ isFollower: true }))).toBe(false);
    expect(canViewPublication(facts, viewer({ viewerId: AUTHOR }))).toBe(true);
  });

  it('un blocage coupe même une publication publique suivie', () => {
    expect(canViewPublication(publication(), viewer({ isFollower: true, blocked: true }))).toBe(
      false,
    );
  });

  it('un visiteur anonyme ne voit que le public', () => {
    const anonymous = viewer({ viewerId: null });
    expect(canViewPublication(publication(), anonymous)).toBe(true);
    expect(canViewPublication(publication({ visibility: 'followers' }), anonymous)).toBe(false);
  });

  it('le contenu signalé attend une décision humaine', () => {
    const flagged = publication({ moderationStatus: 'flagged' });
    expect(canViewPublication(flagged, viewer())).toBe(false);
    expect(canViewPublication(flagged, viewer({ viewerId: AUTHOR }))).toBe(true);
    expect(canViewPublication(flagged, viewer({ isModerator: true }))).toBe(true);
  });

  it('le contenu retiré n’est plus montré, sauf à l’auteur et à la modération', () => {
    const removed = publication({ moderationStatus: 'removed' });
    expect(canViewPublication(removed, viewer())).toBe(false);
    expect(canViewPublication(removed, viewer({ viewerId: AUTHOR }))).toBe(true);
    expect(canViewPublication(removed, viewer({ isModerator: true }))).toBe(true);
  });

  it('une suppression logique prime sur la visibilité', () => {
    const deleted = publication({ deleted: true });
    expect(canViewPublication(deleted, viewer())).toBe(false);
    expect(canViewPublication(deleted, viewer({ isFollower: true }))).toBe(false);
    expect(canViewPublication(deleted, viewer({ viewerId: AUTHOR }))).toBe(true);
  });

  it('un contenu en contrôle automatique reste visible', () => {
    expect(canViewPublication(publication({ moderationStatus: 'pending' }), viewer())).toBe(true);
  });

  it('la modération voit ce qu’un blocage masquerait au public', () => {
    expect(canViewPublication(publication(), viewer({ blocked: true, isModerator: true }))).toBe(
      true,
    );
  });
});

describe('canViewProfile', () => {
  const profile = { userId: AUTHOR, privateAccount: false };

  it('un profil public est visible, sauf blocage', () => {
    expect(canViewProfile(profile, viewer())).toBe(true);
    expect(canViewProfile(profile, viewer({ blocked: true }))).toBe(false);
  });

  it('un compte privé n’ouvre son profil qu’à ses abonnés', () => {
    const closed = { userId: AUTHOR, privateAccount: true };
    expect(canViewProfile(closed, viewer())).toBe(false);
    expect(canViewProfile(closed, viewer({ isFollower: true }))).toBe(true);
  });

  it('le propriétaire et la modération voient toujours le profil', () => {
    const closed = { userId: AUTHOR, privateAccount: true };
    expect(canViewProfile(closed, viewer({ viewerId: AUTHOR }))).toBe(true);
    expect(canViewProfile(closed, viewer({ isModerator: true }))).toBe(true);
  });
});

describe('canInteract', () => {
  it('« tout le monde » accepte un inconnu non bloqué', () => {
    expect(canInteract('everyone', viewer())).toBe(true);
    expect(canInteract('everyone', viewer({ blocked: true }))).toBe(false);
  });

  it('« mes abonnés » exige un abonnement accepté', () => {
    expect(canInteract('followers', viewer({ isFollower: true }))).toBe(true);
    expect(canInteract('followers', viewer())).toBe(false);
  });

  it('« mes abonnements » exige que l’auteur suive le visiteur', () => {
    expect(canInteract('following', viewer({ isFollowedBy: true }))).toBe(true);
    expect(canInteract('following', viewer())).toBe(false);
  });

  it('« personne » refuse toujours, et un visiteur anonyme aussi', () => {
    expect(canInteract('nobody', viewer())).toBe(false);
    expect(canInteract('everyone', viewer({ viewerId: null }))).toBe(false);
  });
});

describe('isPubliclyCacheable', () => {
  const facts = (overrides: Partial<Parameters<typeof isPubliclyCacheable>[0]> = {}) => ({
    visibility: 'public' as const,
    moderationStatus: 'approved' as const,
    deleted: false,
    authorPrivateAccount: false,
    ...overrides,
  });

  it('accepte une publication publique d’un compte public', () => {
    expect(isPubliclyCacheable(facts())).toBe(true);
    // `pending` est l'état d'un contrôle automatique en cours : encore servi.
    expect(isPubliclyCacheable(facts({ moderationStatus: 'pending' }))).toBe(true);
  });

  it('refuse tout ce qui n’est pas réellement public', () => {
    expect(isPubliclyCacheable(facts({ visibility: 'followers' }))).toBe(false);
    expect(isPubliclyCacheable(facts({ visibility: 'private' }))).toBe(false);
    expect(isPubliclyCacheable(facts({ authorPrivateAccount: true }))).toBe(false);
    expect(isPubliclyCacheable(facts({ moderationStatus: 'flagged' }))).toBe(false);
    expect(isPubliclyCacheable(facts({ moderationStatus: 'removed' }))).toBe(false);
    expect(isPubliclyCacheable(facts({ deleted: true }))).toBe(false);
  });
});
