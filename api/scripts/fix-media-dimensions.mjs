#!/usr/bin/env node
/**
 * Corrige les dimensions des médias déjà publiés (photos et vidéos portrait
 * prises au téléphone, enregistrées en paysage avant le correctif de rotation).
 *
 *   node scripts/fix-media-dimensions.mjs          # aperçu, rien n'est écrit
 *   node scripts/fix-media-dimensions.mjs --apply  # applique la correction
 *
 * Source de vérité : les variantes produites par le worker, déjà redressées
 * (`medium` pour une image, `mp4` puis `poster` pour une vidéo). Seuls les
 * assets dont l'orientation diffère (portrait ↔ paysage) sont modifiés.
 */
import 'dotenv/config';
import { Client } from 'pg';

const apply = process.argv.includes('--apply');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL manquante (lance depuis api/, avec api/.env).');
  process.exit(1);
}

const PREFERRED = { image: ['medium', 'thumb'], video: ['mp4', 'poster', 'mp4-low'] };

const client = new Client({ connectionString });
await client.connect();
try {
  const { rows } = await client.query(
    `select id, kind, width, height, variants
     from media_assets
     where kind in ('image', 'video') and status = 'ready' and deleted_at is null
       and width is not null and height is not null and variants is not null`,
  );
  let fixed = 0;
  for (const row of rows) {
    const variants = Array.isArray(row.variants) ? row.variants : [];
    const reference = PREFERRED[row.kind]
      .map((label) => variants.find((variant) => variant.label === label))
      .find((variant) => variant && variant.width > 0 && variant.height > 0);
    if (!reference) {
      continue;
    }
    const storedPortrait = row.height > row.width;
    const displayedPortrait = reference.height > reference.width;
    if (storedPortrait === displayedPortrait || row.width === row.height) {
      continue;
    }
    fixed += 1;
    console.log(
      `${row.id} (${row.kind}) : ${row.width}×${row.height} → ${row.height}×${row.width}`,
    );
    if (apply) {
      await client.query(
        `update media_assets set width = $2, height = $3, updated_at = now() where id = $1`,
        [row.id, row.height, row.width],
      );
    }
  }
  console.log(
    apply
      ? `${fixed} média(s) corrigé(s) sur ${rows.length}.`
      : `${fixed} média(s) à corriger sur ${rows.length}. Relance avec --apply pour écrire.`,
  );
} finally {
  await client.end();
}
