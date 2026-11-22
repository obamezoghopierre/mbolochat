import * as MediaLibrary from 'expo-media-library/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isRejectedMedia,
  normalizeLocalMedia,
  type PickedAttachment,
  type RejectedMedia,
} from '@/features/media/pickMedia';

/**
 * Accès à la photothèque pour le sélecteur « Créer » façon Instagram :
 * pagination `getAssetsAsync` filtrée par type de média, puis conversion des
 * assets choisis en `PickedAttachment` via `normalizeLocalMedia` (mêmes
 * plafonds que la galerie système).
 */

export type CreateLibraryKind = 'all' | 'photo' | 'video';

const PAGE_SIZE = 60;

const MEDIA_TYPES: Record<CreateLibraryKind, MediaLibrary.MediaTypeValue[]> = {
  all: ['photo', 'video', 'pairedVideo'],
  photo: ['photo'],
  video: ['video', 'pairedVideo'],
};

export interface CreateLibrary {
  /** `null` tant que la permission n'est pas accordée. */
  permission: MediaLibrary.PermissionResponse | null;
  requestPermission: () => Promise<MediaLibrary.PermissionResponse>;
  assets: MediaLibrary.Asset[];
  loading: boolean;
  hasNextPage: boolean;
  loadMore: () => void;
}

/**
 * La page mémorise le type de média qu'elle contient : changer de segment
 * (Photo ↔ Vidéo) n'affiche donc jamais la grille de l'autre type, sans avoir
 * à remettre l'état à zéro dans un effet (rendu en cascade).
 */
interface LibraryPage {
  kind: CreateLibraryKind | null;
  assets: MediaLibrary.Asset[];
  hasNextPage: boolean;
}

const EMPTY_ASSETS: MediaLibrary.Asset[] = [];
const EMPTY_PAGE: LibraryPage = { kind: null, assets: EMPTY_ASSETS, hasNextPage: false };

export function useCreateLibrary(kind: CreateLibraryKind | null): CreateLibrary {
  const [permission, requestPermission] = MediaLibrary.usePermissions({
    granularPermissions: ['photo', 'video'],
  });
  const [page, setPage] = useState<LibraryPage>(EMPTY_PAGE);
  const [loading, setLoading] = useState(false);
  const afterRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  const loadPage = useCallback(
    async (after?: string) => {
      if (kind === null || loadingRef.current) {
        return;
      }
      loadingRef.current = true;
      setLoading(true);
      try {
        const result = await MediaLibrary.getAssetsAsync({
          first: PAGE_SIZE,
          after,
          mediaType: MEDIA_TYPES[kind],
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        });
        afterRef.current = result.endCursor;
        setPage((previous) => ({
          kind,
          hasNextPage: result.hasNextPage,
          assets:
            after && previous.kind === kind
              ? [...previous.assets, ...result.assets]
              : result.assets,
        }));
      } catch {
        setPage((previous) => ({ ...previous, hasNextPage: false }));
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [kind],
  );

  // Le chargement ne remet pas l'état à zéro de façon synchrone : la page
  // affichée est dérivée de `page.kind`, donc changer de segment suffit.
  useEffect(() => {
    if (kind === null || permission?.granted !== true) {
      return;
    }
    afterRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPage();
  }, [kind, permission?.granted, loadPage]);

  const current = page.kind === kind && kind !== null ? page : EMPTY_PAGE;

  const loadMore = useCallback(() => {
    if (current.hasNextPage && afterRef.current !== null) {
      void loadPage(afterRef.current);
    }
  }, [current.hasNextPage, loadPage]);

  return {
    permission,
    requestPermission,
    assets: current.assets,
    loading,
    hasNextPage: current.hasNextPage,
    loadMore,
  };
}

/** Convertit un asset de la photothèque en pièce jointe publiable. */
export async function assetToPicked(
  asset: MediaLibrary.Asset,
): Promise<PickedAttachment | RejectedMedia> {
  const kind =
    asset.mediaType === 'video' || asset.mediaType === 'pairedVideo' ? 'video' : 'image';
  return normalizeLocalMedia({
    uri: asset.uri,
    kind,
    name: asset.filename,
    width: asset.width,
    height: asset.height,
    durationMs: asset.duration > 0 ? Math.round(asset.duration * 1000) : undefined,
  });
}

export function isPickedAsset(
  value: PickedAttachment | RejectedMedia,
): value is PickedAttachment {
  return !isRejectedMedia(value);
}
