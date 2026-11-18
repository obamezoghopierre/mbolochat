import { describe, expect, it } from 'vitest';

import { parseSocialText } from './rich-text';

describe('parseSocialText', () => {
  it('découpe mentions et hashtags en segments actifs', () => {
    expect(parseSocialText('Salut @Feed.Demo, voici #MboloTag !')).toEqual([
      { kind: 'text', value: 'Salut ' },
      { kind: 'mention', username: 'feed.demo', value: '@Feed.Demo' },
      { kind: 'text', value: ', voici ' },
      { kind: 'hashtag', tag: 'mbolotag', value: '#MboloTag' },
      { kind: 'text', value: ' !' },
    ]);
  });

  it('ignore les adresses email et les dièses isolés', () => {
    expect(parseSocialText('mail@test.dev et # et abc#def')).toEqual([
      { kind: 'text', value: 'mail@test.dev et # et abc#def' },
    ]);
  });

  it('rend les URL http(s) cliquables sans la ponctuation finale', () => {
    expect(parseSocialText('Voir https://example.com/page, merci !')).toEqual([
      { kind: 'text', value: 'Voir ' },
      { kind: 'link', url: 'https://example.com/page', value: 'https://example.com/page' },
      { kind: 'text', value: ', merci !' },
    ]);
  });

  it('tronque le libellé des liens longs sans toucher à l’URL', () => {
    const url = `https://exemple.com/articles/${'a'.repeat(60)}`;
    expect(parseSocialText(url)).toEqual([
      { kind: 'link', url, value: `${url.slice(0, 41)}…` },
    ]);
  });

  it('mélange URL, mention et hashtag', () => {
    expect(parseSocialText('@feed.demo https://mbolo.cd #Fusión')).toEqual([
      { kind: 'mention', username: 'feed.demo', value: '@feed.demo' },
      { kind: 'text', value: ' ' },
      { kind: 'link', url: 'https://mbolo.cd', value: 'https://mbolo.cd' },
      { kind: 'text', value: ' ' },
      { kind: 'hashtag', tag: 'fusion', value: '#Fusión' },
    ]);
  });

  it('ne rend pas actifs les autres schémas', () => {
    expect(parseSocialText('ftp://serveur.fr et javascript:alert(1)')).toEqual([
      { kind: 'text', value: 'ftp://serveur.fr et javascript:alert(1)' },
    ]);
  });

  it('normalise les accents des hashtags', () => {
    expect(parseSocialText('#Fusión')).toEqual([
      { kind: 'hashtag', tag: 'fusion', value: '#Fusión' },
    ]);
  });
});
