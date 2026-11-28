import { describe, expect, it } from 'vitest';

import {
  extractHashtags,
  extractMentions,
  extractTopics,
  MAX_TOPICS_PER_PUBLICATION,
} from './social-tags.js';

describe('extractMentions', () => {
  it('retourne les pseudos en minuscules, sans doublon', () => {
    expect(extractMentions('Salut @Kim.Test et @kim.test, merci @feed_demo !')).toEqual([
      'kim.test',
      'feed_demo',
    ]);
  });

  it('ignore les adresses et les caractères collés', () => {
    expect(extractMentions('mail@test.dev et @abc@def et x@y')).toEqual([]);
  });

  it('ne garde pas le point de ponctuation final', () => {
    expect(extractMentions('Coucou @kim.test.')).toEqual(['kim.test']);
  });
});

describe('extractHashtags', () => {
  it('retourne les tags en minuscules, sans # ni doublon', () => {
    expect(extractHashtags('#Mbolo #mbolo et #Fusión')).toEqual(['mbolo', 'fusion']);
  });

  it('ignore un # isolé ou collé à un mot', () => {
    expect(extractHashtags('# et abc#def')).toEqual([]);
  });
});

describe('extractTopics', () => {
  it('garde les mots porteurs de sens, sans accent ni doublon', () => {
    expect(extractTopics('Un super match de football à Libreville, quel football !')).toEqual([
      'football',
      'super',
      'match',
      'libreville',
    ]);
  });

  it('ignore les mots vides et les mots trop courts', () => {
    // « il », « a », « dit », « que », « le », « est », « sur », « un » : vides ou trop courts.
    expect(extractTopics('Il a dit que le chat est sur un toit')).toEqual(['chat', 'toit']);
  });

  it('ignore les hashtags, les mentions, les liens et les nombres', () => {
    expect(
      extractTopics('Voyage #Mbolo avec @kim.test https://exemple.com/page 2026 plage'),
    ).toEqual(['voyage', 'plage']);
  });

  it('classe par fréquence puis par ordre d’apparition', () => {
    expect(extractTopics('cuisine voyage cuisine plage voyage cuisine')).toEqual([
      'cuisine',
      'voyage',
      'plage',
    ]);
  });

  it('borne le nombre de sujets', () => {
    const text = 'alpha bravo charlie delta echos foxtrot golfe hotel india juliet kilos';
    expect(extractTopics(text)).toHaveLength(MAX_TOPICS_PER_PUBLICATION);
    expect(extractTopics(text, 3)).toEqual(['alpha', 'bravo', 'charlie']);
    expect(extractTopics(text, 0)).toEqual([]);
  });

  it('rend une liste vide pour un texte vide ou sans sujet', () => {
    expect(extractTopics('')).toEqual([]);
    expect(extractTopics('Il est la et on va y')).toEqual([]);
  });
});
