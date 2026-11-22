import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Applique les migrations une fois, avant les suites e2e. Chaque suite garde
 * son propre `migrate()` : sur une base déjà à jour, il ne fait plus rien.
 * Même URL de repli que `drizzle.config.ts`.
 */
export default async function setup(): Promise<void> {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://mbolochat:mbolochat@localhost:5432/mbolochat',
  });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  } finally {
    await pool.end();
  }
}
