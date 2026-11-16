import { describe, expect, it } from 'vitest';

import {
  voiceBarCount,
  voiceBubbleLayoutWidth,
  voiceBubbleMinWidth,
  voiceBubbleWidth,
  voiceTrailingWidth,
  type VoiceLayoutMetrics,
} from './voiceBubbleLayout';

/** Valeurs de `ChatMetrics` (design system), recopiées pour rester sans React Native. */
const METRICS: VoiceLayoutMetrics = {
  bubblePaddingH: 12,
  playSize: 28,
  controlWidth: 32,
  controlGap: 8,
  chipGap: 4,
  durationMinWidth: 30,
  barWidth: 3,
  barGap: 3,
};

const MAX_DURATION_MS = 60_000;
const GAP = METRICS.controlGap;

describe('largeur réservée à droite de la forme d’onde', () => {
  it('compte la durée seule', () => {
    expect(voiceTrailingWidth(METRICS, false, false)).toBe(METRICS.durationMinWidth + GAP);
  });

  it('groupe la durée et la vitesse avec un écart resserré', () => {
    expect(voiceTrailingWidth(METRICS, true, false)).toBe(
      GAP + METRICS.durationMinWidth + METRICS.chipGap + METRICS.controlWidth,
    );
  });

  it('ajoute « Aa » avant le bloc durée + vitesse', () => {
    expect(voiceTrailingWidth(METRICS, true, true)).toBe(
      GAP +
        GAP +
        METRICS.controlWidth +
        METRICS.durationMinWidth +
        METRICS.chipGap +
        METRICS.controlWidth,
    );
  });
});

describe('nombre de barres de la forme d’onde', () => {
  const trailing = voiceTrailingWidth(METRICS, true, true);
  const width = voiceBubbleLayoutWidth(METRICS, 30_000, 400, true, true);

  it('remplit exactement l’espace disponible sans déborder', () => {
    const available =
      width - METRICS.bubblePaddingH * 2 - METRICS.playSize - GAP - trailing;
    const count = voiceBarCount(METRICS, width, trailing);
    expect(count * (METRICS.barWidth + METRICS.barGap)).toBeLessThanOrEqual(
      available + METRICS.barGap,
    );
    expect((count + 1) * (METRICS.barWidth + METRICS.barGap)).toBeGreaterThan(
      available + METRICS.barGap,
    );
  });

  it('garde au moins six barres sur un vocal très court', () => {
    const short = voiceBubbleLayoutWidth(METRICS, 500, 400, true, true);
    expect(voiceBarCount(METRICS, short, trailing)).toBeGreaterThanOrEqual(6);
  });

  it('donne plus de barres sur un vocal long que sur un court', () => {
    const long = voiceBubbleLayoutWidth(METRICS, MAX_DURATION_MS, 400, true, true);
    const short = voiceBubbleLayoutWidth(METRICS, 3_000, 400, true, true);
    expect(voiceBarCount(METRICS, long, trailing)).toBeGreaterThan(
      voiceBarCount(METRICS, short, trailing),
    );
  });
});

describe('largeur de la bulle vocale', () => {
  it('grandit avec la durée, dans les bornes', () => {
    expect(voiceBubbleWidth(5_000, 400)).toBeGreaterThanOrEqual(120);
    expect(voiceBubbleWidth(5_000, 400)).toBeLessThan(voiceBubbleWidth(30_000, 400));
    expect(voiceBubbleWidth(30_000, 400)).toBeLessThan(voiceBubbleWidth(MAX_DURATION_MS, 400));
    expect(voiceBubbleWidth(MAX_DURATION_MS, 400)).toBeLessThanOrEqual(320);
  });

  it('se plafonne à 72 % de la largeur d’écran sur un petit écran', () => {
    expect(voiceBubbleWidth(MAX_DURATION_MS, 300)).toBeLessThanOrEqual(216);
  });

  it('ne descend jamais sous la largeur qui laisse respirer l’onde', () => {
    const min = voiceBubbleMinWidth(METRICS, true, true);
    expect(voiceBubbleLayoutWidth(METRICS, 500, 400, true, true)).toBe(min);
    expect(min).toBeGreaterThan(voiceBubbleMinWidth(METRICS, true, false));
  });
});
