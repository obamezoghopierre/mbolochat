import { describe, expect, it } from 'vitest';

import { isShortTextPost, splitCaption } from './text-post';

describe('splitCaption', () => {
  it('renvoie un titre vide sans contenu pour un caption absent', () => {
    expect(splitCaption(null)).toEqual({ title: '', body: null });
    expect(splitCaption('   ')).toEqual({ title: '', body: null });
  });

  it('utilise le texte entier comme titre quand il n’y a qu’une ligne', () => {
    expect(splitCaption('Mon premier post')).toEqual({ title: 'Mon premier post', body: null });
  });

  it('sépare la première ligne du reste du texte', () => {
    expect(splitCaption('Un titre\nUn contenu plus détaillé')).toEqual({
      title: 'Un titre',
      body: 'Un contenu plus détaillé',
    });
  });

  it('ignore les lignes vides en début et fin de contenu', () => {
    expect(splitCaption('  Titre  \n\n  Corps  \n ')).toEqual({
      title: 'Titre',
      body: 'Corps',
    });
  });

  it('conserve un contenu sur plusieurs lignes', () => {
    expect(splitCaption('Titre\nPremière ligne\nDeuxième ligne')).toEqual({
      title: 'Titre',
      body: 'Première ligne\nDeuxième ligne',
    });
  });

  it('ne crée pas de corps vide quand le texte se termine par un saut de ligne', () => {
    expect(splitCaption('Titre\n')).toEqual({ title: 'Titre', body: null });
  });
});

describe('isShortTextPost', () => {
  it('accepte une page unique courte, avec ou sans titre', () => {
    expect(isShortTextPost('', ['Bonjour'])).toBe(true);
    expect(isShortTextPost('Mon titre', ['Corps de quelques mots'])).toBe(true);
    expect(isShortTextPost('Titre', ['mot '.repeat(60)])).toBe(true);
  });

  it('refuse les pages vides et les multi-pages', () => {
    expect(isShortTextPost('', [])).toBe(false);
    expect(isShortTextPost('', ['   '])).toBe(false);
    expect(isShortTextPost('', ['Un', 'Deux'])).toBe(false);
  });

  it('refuse un titre ou un corps trop long', () => {
    expect(isShortTextPost('x'.repeat(161), ['Corps'])).toBe(false);
    expect(isShortTextPost('Titre', ['y'.repeat(321)])).toBe(false);
  });

  it('ignore les espaces de bord et les pages vignes', () => {
    expect(isShortTextPost('  Titre  ', ['  Salut  ', ''])).toBe(true);
  });
});
