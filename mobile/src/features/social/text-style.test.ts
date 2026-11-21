import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TEXT_ALIGN,
  DEFAULT_TEXT_FONT,
  TEXT_ALIGNS,
  TEXT_COLORS,
  TEXT_FONTS,
  textAlignValue,
  textColorByKey,
  textFontByKey,
  textFontFamily,
  textFontStyle,
} from './text-style';

describe('textFontByKey', () => {
  it('retrouve une police connue', () => {
    expect(textFontByKey('typewriter')?.key).toBe('typewriter');
    expect(textFontByKey('classic')?.key).toBe('classic');
  });

  it('rejette une clé absente ou inconnue', () => {
    expect(textFontByKey(null)).toBeNull();
    expect(textFontByKey(undefined)).toBeNull();
    expect(textFontByKey('comic-sans')).toBeNull();
  });

  it('le défaut est toujours dans le catalogue', () => {
    expect(TEXT_FONTS.some((font) => font.key === DEFAULT_TEXT_FONT)).toBe(true);
  });
});

describe('textFontFamily', () => {
  it('résout la famille par plateforme', () => {
    const typewriter = textFontByKey('typewriter');
    expect(typewriter).not.toBeNull();
    expect(textFontFamily(typewriter!, 'ios')).toBe('Courier');
    expect(textFontFamily(typewriter!, 'android')).toBe('monospace');
    expect(textFontFamily(typewriter!, 'web')).toBeUndefined();
  });

  it('une police sans famille déclarée n’en impose pas', () => {
    const classic = textFontByKey('classic');
    expect(classic?.fontFamily).toBeUndefined();
    expect(textFontFamily(classic!, 'ios')).toBeUndefined();
  });
});

describe('textFontStyle', () => {
  it('compose graisse, espacement et famille', () => {
    const bold = textFontStyle(textFontByKey('bold'), 'android');
    expect(bold.fontWeight).toBe('800');
    expect(bold.letterSpacing).toBeGreaterThan(0);
    expect(bold.fontFamily).toBeUndefined();
  });

  it('renvoie un style vide pour une police inconnue', () => {
    expect(textFontStyle(null, 'ios')).toEqual({});
  });
});

describe('textColorByKey', () => {
  it('retrouve une couleur connue avec sa teinte', () => {
    expect(textColorByKey('coral')?.color).toBe('#FF7A59');
    expect(textColorByKey('black')?.color).toBe('#0B0F14');
  });

  it('rejette une clé absente ou inconnue', () => {
    expect(textColorByKey(null)).toBeNull();
    expect(textColorByKey('auto')).toBeNull();
    expect(textColorByKey('chartreuse')).toBeNull();
  });

  it('chaque couleur a une teinte hexadécimale et un libellé', () => {
    for (const color of TEXT_COLORS) {
      expect(color.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(color.labelKey).toMatch(/^social\.createColor\w+$/);
    }
  });
});

describe('textAlignValue', () => {
  it('accepte left et right, centre le reste', () => {
    expect(textAlignValue('left')).toBe('left');
    expect(textAlignValue('right')).toBe('right');
    expect(textAlignValue('center')).toBe(DEFAULT_TEXT_ALIGN);
    expect(textAlignValue(null)).toBe(DEFAULT_TEXT_ALIGN);
    expect(textAlignValue('justify')).toBe('justify');
  });

  it('le catalogue d’alignements ne propose que des valeurs persistables', () => {
    expect(TEXT_ALIGNS.map((align) => align.key).sort()).toEqual([
      'center',
      'justify',
      'left',
      'right',
    ]);
  });
});
