import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VOICE_SPEED,
  nextVoiceSpeed,
  parseVoiceSpeed,
  VOICE_SPEEDS,
} from './voiceSpeed';

describe('vitesse de lecture des notes vocales', () => {
  it('boucle 1x → 1,5x → 2x → 1x', () => {
    expect(nextVoiceSpeed(1)).toBe(1.5);
    expect(nextVoiceSpeed(1.5)).toBe(2);
    expect(nextVoiceSpeed(2)).toBe(1);
  });

  it('parcourt exactement les vitesses connues, sans en sauter', () => {
    let speed = DEFAULT_VOICE_SPEED;
    const seen: number[] = [];
    for (let i = 0; i < VOICE_SPEEDS.length; i++) {
      seen.push(speed);
      speed = nextVoiceSpeed(speed);
    }
    expect(seen).toEqual([...VOICE_SPEEDS]);
    expect(speed).toBe(DEFAULT_VOICE_SPEED);
  });

  it('accepte uniquement les vitesses connues', () => {
    expect(parseVoiceSpeed('1.5')).toBe(1.5);
    expect(parseVoiceSpeed('2')).toBe(2);
    expect(parseVoiceSpeed('1,5')).toBe(1.5);
    expect(parseVoiceSpeed('3')).toBe(1);
    expect(parseVoiceSpeed('vite')).toBe(1);
    expect(parseVoiceSpeed(null)).toBe(1);
    expect(parseVoiceSpeed(undefined)).toBe(1);
    expect(parseVoiceSpeed({})).toBe(1);
  });

  it('démarre à 1x sans état partagé entre messages', () => {
    expect(DEFAULT_VOICE_SPEED).toBe(1);
    // Le module ne mémorise rien : deux instances qui avancent indépendamment
    // changent de vitesse sans se voir.
    const first = nextVoiceSpeed(DEFAULT_VOICE_SPEED);
    const second = nextVoiceSpeed(DEFAULT_VOICE_SPEED);
    expect(first).toBe(second);
    expect(nextVoiceSpeed(first)).toBe(2);
    expect(nextVoiceSpeed(DEFAULT_VOICE_SPEED)).toBe(first);
    expect(DEFAULT_VOICE_SPEED).toBe(1);
  });
});
