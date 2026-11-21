import { describe, expect, it } from 'vitest';

import { firstHttpUrl, parseLinkPreview } from './link-preview.js';

describe('firstHttpUrl', () => {
  it('extrait la première URL http/https du texte', () => {
    expect(firstHttpUrl('Regarde https://example.com/article, super !')).toBe(
      'https://example.com/article',
    );
    expect(firstHttpUrl('ftp://x.com puis http://a.b/c')).toBe('http://a.b/c');
  });

  it('renvoie null sans URL ou avec un schéma non web', () => {
    expect(firstHttpUrl('pas de lien ici')).toBeNull();
    expect(firstHttpUrl('mailto:a@b.c')).toBeNull();
    expect(firstHttpUrl('')).toBeNull();
  });

  it('ignore les URL invalides', () => {
    expect(firstHttpUrl('https://')).toBeNull();
  });
});

describe('parseLinkPreview', () => {
  it('lit les métadonnées Open Graph', () => {
    const html = `<html><head>
      <meta property="og:title" content="Un titre &amp; plus">
      <meta property="og:description" content="Description">
      <meta property="og:image" content="/img.png">
      <title>Fallback</title></head></html>`;
    const meta = parseLinkPreview(html, 'https://example.com/page');
    expect(meta).toEqual({
      url: 'https://example.com/page',
      host: 'example.com',
      title: 'Un titre & plus',
      description: 'Description',
      imageUrl: 'https://example.com/img.png',
    });
  });

  it('retombe sur <title> et l’hôte sans OG', () => {
    const meta = parseLinkPreview('<title>Page &lt;test&gt;</title>', 'http://www.site.fr/x');
    expect(meta?.title).toBe('Page <test>');
    expect(meta?.host).toBe('site.fr');
    expect(meta?.imageUrl).toBeNull();
  });

  it('rejette les images non https et tronque les champs longs', () => {
    const html = `<meta property="og:title" content="${'t'.repeat(200)}">
      <meta property="og:image" content="http://insecure.example/i.png">`;
    const meta = parseLinkPreview(html, 'https://example.com');
    expect(meta?.title.length).toBeLessThanOrEqual(90);
    expect(meta?.imageUrl).toBeNull();
  });
});
