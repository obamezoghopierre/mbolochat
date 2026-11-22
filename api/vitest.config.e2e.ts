import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Une suite à la fois : chaque suite démarre sa propre API sur la même base,
    // et la reprise des effets de messages (`MessageEventsDispatcher.sweep`)
    // traite toutes les lignes en attente — en parallèle, une suite volait les
    // effets d'une autre (message-events.e2e-spec échouait avec api.e2e-spec).
    fileParallelism: false,
    // Migrations appliquées une seule fois, avant toutes les suites : sur une
    // base neuve (CI), les suites lancées en parallèle appelaient `migrate()`
    // en même temps et se marchaient dessus sur `drizzle.__drizzle_migrations`.
    globalSetup: ['./test/global-setup.ts'],
    // Les suites e2e partagent la même base : on coupe la reprise périodique
    // du journal (chaque suite pilote son worker explicitement), sinon une
    // instance peut délivrer les effets d'une autre.
    env: { MESSAGE_EVENTS_SWEEP_MS: '600000' },
  },
});
