import { describe, expect, it } from 'vitest';

import { extractHashtags, extractMentions } from './social-tags.js';

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
