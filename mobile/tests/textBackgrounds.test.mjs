import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Le style d'un post texte existe en trois endroits : le client (rendu et
 * sélecteurs), le DTO API (validation) et i18n (libellés). Une clé ajoutée
 * d'un seul côté casse silencieusement la publication (400 côté serveur)
 * ou affiche une clé brute : ce test verrouille les parités.
 */

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.join(ROOT, '..', '..');

const THEME = path.join(REPO, 'mobile/src/constants/theme.ts');
const STYLE = path.join(REPO, 'mobile/src/features/social/text-style.ts');
const DTO = path.join(REPO, 'api/src/publications/dto/create-publication.dto.ts');
const I18N = path.join(REPO, 'mobile/src/i18n/fr.ts');

function block(source, start, endPattern) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `bloc introuvable : ${start}`);
  const rest = source.slice(from);
  const relativeEnd = rest.search(endPattern);
  assert.ok(relativeEnd > 0, `bloc non terminé : ${start}`);
  return rest.slice(0, relativeEnd);
}

/** Clés de `FeedTextPost.backgrounds` dans theme.ts. */
function themeBackgroundKeys() {
  const source = readFileSync(THEME, 'utf8');
  const region = block(source, 'backgrounds: {', /\}\s+as const satisfies/);
  return [...region.matchAll(/^ {4}(\w+): \{/gm)].map((match) => match[1]);
}

/** Clés de `TEXT_BACKGROUNDS` dans le DTO API. */
function dtoBackgrounds() {
  const source = readFileSync(DTO, 'utf8');
  const region = block(source, 'export const TEXT_BACKGROUNDS = [', /\] as const/);
  return [...region.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
}

/** Clés de `TEXT_FONTS` / `TEXT_ALIGNS` dans text-style.ts. */
function clientList(name) {
  const source = readFileSync(STYLE, 'utf8');
  const region = block(source, `export const ${name}:`, /\] as const|\];/);
  if (name === 'TEXT_FONTS') {
    return [...region.matchAll(/key: '(\w+)'/g)].map((match) => match[1]);
  }
  return [...region.matchAll(/key: '(\w+)'/g)].map((match) => match[1]);
}

/** Clés d'une liste `as const` du DTO. */
function dtoList(name) {
  const source = readFileSync(DTO, 'utf8');
  const region = block(source, `export const ${name} = [`, /\] as const/);
  return [...region.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
}

test('les fonds du thème et le DTO API listent les mêmes clés', () => {
  const keys = themeBackgroundKeys();
  assert.ok(keys.length >= 10);
  assert.deepEqual([...keys].sort(), [...dtoBackgrounds()].sort());
});

test('chaque fond a un libellé français', () => {
  const i18n = readFileSync(I18N, 'utf8');
  const names = block(i18n, 'createBackgroundName:', /\}\)\[key\]/);
  for (const key of themeBackgroundKeys()) {
    assert.match(names, new RegExp(`\\b${key}:`), `fond sans libellé : ${key}`);
  }
});

test('les polices du client et le DTO API listent les mêmes clés', () => {
  const keys = clientList('TEXT_FONTS');
  assert.ok(keys.length >= 4);
  assert.deepEqual([...keys].sort(), [...dtoList('TEXT_FONTS')].sort());
});

test('les alignements du client et le DTO API listent les mêmes clés', () => {
  assert.deepEqual([...clientList('TEXT_ALIGNS')].sort(), [...dtoList('TEXT_ALIGNS')].sort());
});

test('les couleurs de texte du client et le DTO API listent les mêmes clés', () => {
  const keys = clientList('TEXT_COLORS');
  assert.ok(keys.length >= 6);
  assert.deepEqual([...keys].sort(), [...dtoList('TEXT_COLORS')].sort());
});

test('chaque police et alignement a un libellé français', () => {
  const i18n = readFileSync(I18N, 'utf8');
  const source = readFileSync(STYLE, 'utf8');
  const labelKeys = [
    ...block(source, 'export const TEXT_FONTS:', /\];/).matchAll(/labelKey: 'social\.(\w+)'/g),
    ...block(source, 'export const TEXT_ALIGNS:', /\];/).matchAll(/labelKey: 'social\.(\w+)'/g),
    ...block(source, 'export const TEXT_COLORS:', /\] as const|\];/).matchAll(
      /labelKey: 'social\.(\w+)'/g,
    ),
  ];
  assert.ok(labelKeys.length >= 15);
  for (const [, name] of labelKeys) {
    assert.match(i18n, new RegExp(`\\b${name}:`), `libellé manquant : ${name}`);
  }
});
