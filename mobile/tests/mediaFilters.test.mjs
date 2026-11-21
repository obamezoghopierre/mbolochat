import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Le catalogue de filtres existe en deux endroits : le client (rendu et
 * sélecteur) et le DTO API (validation). Une clé ajoutée d'un seul côté casse
 * silencieusement la publication (400 côté serveur) : ce test verrouille la
 * parité, ainsi que la présence de chaque libellé français.
 */

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.join(ROOT, '..', '..');

const CATALOG = path.join(REPO, 'mobile/src/features/media/media-filter.tsx');
const DTO = path.join(REPO, 'api/src/publications/dto/create-publication.dto.ts');
const I18N = path.join(REPO, 'mobile/src/i18n/fr.ts');

function block(source, start) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `bloc introuvable : ${start}`);
  const rest = source.slice(from);
  const relativeEnd = rest.search(/\](\s+as const)?;/);
  assert.ok(relativeEnd > 0, `bloc non terminé : ${start}`);
  return rest.slice(0, relativeEnd);
}

function catalogKeys() {
  const source = readFileSync(CATALOG, 'utf8');
  const keys = [...block(source, 'MEDIA_FILTERS: readonly MediaFilter[] = [').matchAll(/key: '([a-z-]+)'/g)];
  return keys.map((match) => match[1]);
}

function dtoFilters() {
  const source = readFileSync(DTO, 'utf8');
  const entries = [...block(source, 'export const MEDIA_FILTERS = [').matchAll(/'([a-z-]+)'/g)];
  return entries.map((match) => match[1]);
}

test('le catalogue mobile et le DTO API listent les mêmes filtres', () => {
  const keys = catalogKeys();
  assert.ok(keys.length >= 5);
  assert.deepEqual([...keys].sort(), [...dtoFilters()].sort());
});

test('chaque filtre a un libellé français', () => {
  const source = readFileSync(CATALOG, 'utf8');
  const labelKeys = [...block(source, 'MEDIA_FILTERS: readonly MediaFilter[] = [').matchAll(/labelKey: '([\w.]+)'/g)];
  const i18n = readFileSync(I18N, 'utf8');
  for (const [, labelKey] of labelKeys) {
    const name = labelKey.split('.').pop();
    assert.match(i18n, new RegExp(`\\b${name}:`), `libellé manquant : ${labelKey}`);
  }
  assert.equal(labelKeys.length, catalogKeys().length);
});
