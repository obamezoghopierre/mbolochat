import { describe, expect, it } from 'vitest';

import {
  buildVideoArgs,
  computePosterSeekSeconds,
  displayedImageSize,
  VIDEO_PROFILE_LOW,
  VIDEO_PROFILE_MAIN,
  videoRotation,
} from './media-processors.js';

/**
 * Le poster ne doit pas être la frame 0 : beaucoup de vidéos s'ouvrent sur un
 * fondu depuis le noir, et la frame 0 est alors noire (vignette inexploitable).
 * On choisit un point d'extraction légèrement entré dans la vidéo, en sautant
 * le noir initial détecté, sans jamais dépasser la fin d'un clip court.
 */
describe('computePosterSeekSeconds', () => {
  it('vise un dixième de la durée, plafonné pour rester près du début', () => {
    // 52 s → 10 % = 5,2 s, plafonné à 5 s.
    expect(computePosterSeekSeconds(52, null)).toBeCloseTo(5, 5);
    // 20 s → 10 % = 2 s.
    expect(computePosterSeekSeconds(20, null)).toBeCloseTo(2, 5);
  });

  it('ne descend pas sous un plancher pour les clips très courts', () => {
    // 1 s → 10 % = 0,1 s, mais plancher 0,25 s (sous 90 % de 1 s).
    expect(computePosterSeekSeconds(1, null)).toBeCloseTo(0.25, 5);
  });

  it('saute le fondu noir initial détecté', () => {
    // Clip de 4 s dont le noir dure 1,5 s : le point de base (0,4 s) est noir,
    // on vise donc au-delà du noir (1,5 + 0,5 = 2 s).
    expect(computePosterSeekSeconds(4, 1.5)).toBeCloseTo(2, 5);
  });

  it('garde le point le plus tardif quand le noir est court', () => {
    // 52 s, noir jusqu'à 1,2 s : 10 % (5 s) est déjà au-delà du noir + marge.
    expect(computePosterSeekSeconds(52, 1.2)).toBeCloseTo(5, 5);
  });

  it('ne dépasse jamais la fin d’un clip court', () => {
    // 2 s avec un noir de 1,9 s : noir + marge = 2,4 s > durée, on borne à 90 %.
    expect(computePosterSeekSeconds(2, 1.9)).toBeCloseTo(1.8, 5);
  });

  it('reste positif et borné même sans durée connue', () => {
    const seek = computePosterSeekSeconds(0, null);
    expect(seek).toBeGreaterThanOrEqual(0);
    expect(seek).toBeLessThanOrEqual(5);
  });
});

/**
 * Dimensions annoncées au fil : celles **affichées**, après rotation. Une
 * photo ou une vidéo portrait prise au téléphone est souvent stockée en
 * paysage avec une rotation ; sans correction, le fil la cadre en paysage.
 */
describe('displayedImageSize', () => {
  it('échange largeur et hauteur pour les orientations EXIF 5 à 8', () => {
    expect(displayedImageSize(4032, 3024, 6)).toEqual([3024, 4032]);
    expect(displayedImageSize(4032, 3024, 8)).toEqual([3024, 4032]);
  });

  it('garde les dimensions sans rotation d’un quart de tour', () => {
    expect(displayedImageSize(4032, 3024, 1)).toEqual([4032, 3024]);
    expect(displayedImageSize(4032, 3024, 3)).toEqual([4032, 3024]);
    expect(displayedImageSize(4032, 3024, undefined)).toEqual([4032, 3024]);
  });
});

describe('videoRotation', () => {
  it('lit la matrice d’affichage des téléphones récents', () => {
    expect(videoRotation({ side_data_list: [{ rotation: -90 }] })).toBe(270);
    expect(videoRotation({ side_data_list: [{ rotation: 90 }] })).toBe(90);
  });

  it('lit l’ancien tag rotate, et 0 sans information', () => {
    expect(videoRotation({ tags: { rotate: '90' } })).toBe(90);
    expect(videoRotation({ tags: { rotate: '180' } })).toBe(180);
    expect(videoRotation({})).toBe(0);
  });
});

/**
 * Arguments d'encodage : le plafond de débit protège la lecture en 4G (le CRF
 * seul ne borne pas les pics), et les deux variantes partagent le même GOP et
 * les mêmes options de compatibilité, pour que le seek et le décodage Android
 * se comportent pareil quelle que soit la qualité servie.
 */
describe('buildVideoArgs', () => {
  const valueOf = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

  it('plafonne le débit du rendu principal avec un tampon de deux secondes', () => {
    const args = buildVideoArgs('in', 'out.mp4', VIDEO_PROFILE_MAIN);
    expect(valueOf(args, '-maxrate')).toBe('3500k');
    expect(valueOf(args, '-bufsize')).toBe('7000k');
    expect(valueOf(args, '-crf')).toBe('23');
    expect(valueOf(args, '-b:a')).toBe('128k');
    expect(valueOf(args, '-vf')).toBe("scale='min(1080,iw)':-2");
  });

  it('plafonne bien plus bas la variante basse qualité', () => {
    const args = buildVideoArgs('in', 'out-low.mp4', VIDEO_PROFILE_LOW);
    expect(valueOf(args, '-maxrate')).toBe('900k');
    expect(valueOf(args, '-bufsize')).toBe('1800k');
    expect(valueOf(args, '-crf')).toBe('30');
    expect(valueOf(args, '-b:a')).toBe('96k');
    expect(valueOf(args, '-vf')).toBe("scale='min(540,iw)':-2");
  });

  it('garde un tampon égal à deux fois le débit maximal sur chaque profil', () => {
    for (const profile of [VIDEO_PROFILE_MAIN, VIDEO_PROFILE_LOW]) {
      expect(profile.bufsizeKbps).toBe(profile.maxrateKbps * 2);
    }
  });

  it('garde la variante basse plus légère que le rendu principal', () => {
    expect(VIDEO_PROFILE_LOW.maxrateKbps).toBeLessThan(VIDEO_PROFILE_MAIN.maxrateKbps);
    expect(VIDEO_PROFILE_LOW.maxWidth).toBeLessThan(VIDEO_PROFILE_MAIN.maxWidth);
  });

  it('utilise le preset medium et conserve les options de compatibilité', () => {
    const args = buildVideoArgs('in', 'out.mp4', VIDEO_PROFILE_MAIN);
    expect(valueOf(args, '-preset')).toBe('medium');
    expect(valueOf(args, '-pix_fmt')).toBe('yuv420p');
    expect(valueOf(args, '-movflags')).toBe('+faststart');
    expect(valueOf(args, '-g')).toBe(valueOf(args, '-keyint_min'));
    expect(valueOf(args, '-sc_threshold')).toBe('0');
  });

  it('lit l’entrée et écrit la sortie aux bons endroits', () => {
    const args = buildVideoArgs('/tmp/in', '/tmp/out.mp4', VIDEO_PROFILE_MAIN);
    expect(valueOf(args, '-i')).toBe('/tmp/in');
    expect(args.at(-1)).toBe('/tmp/out.mp4');
  });
});
