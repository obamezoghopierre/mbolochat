#!/usr/bin/env node
/**
 * Attribue un rôle de modération à un compte existant.
 *
 *   node scripts/promote-role.mjs <email-ou-pseudo> <moderator|admin>
 *
 * Le rôle est la seule source d'autorisation de `/admin` (AdminGuard relit la
 * base à chaque requête). Aucun mot de passe n'est créé ni modifié ici : le
 * compte doit déjà exister.
 */
import 'dotenv/config';
import { Client } from 'pg';

const ROLES = new Set(['user', 'moderator', 'admin']);

const [identifier, role] = process.argv.slice(2);
if (!identifier || !role || !ROLES.has(role)) {
  console.error('Usage : node scripts/promote-role.mjs <email-ou-pseudo> <moderator|admin>');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL manquante (lance depuis api/, avec api/.env).');
  process.exit(1);
}

const client = new Client({ connectionString });
await client.connect();
try {
  const result = await client.query(
    `update users set role = $1
     where email = $2 or username = $2
     returning id, username, email, role`,
    [role, identifier],
  );
  if (result.rowCount === 0) {
    console.error(`Aucun compte ne correspond à « ${identifier} ».`);
    process.exitCode = 1;
  } else {
    const row = result.rows[0];
    console.log(`@${row.username} (${row.email}) a maintenant le rôle « ${row.role} ».`);
  }
} finally {
  await client.end();
}
