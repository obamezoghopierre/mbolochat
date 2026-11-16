import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Le back-office est servi par l'API sous `/admin/`. En développement, Vite
 * proxifie les appels d'API vers le serveur NestJS local.
 */
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  build: { outDir: 'dist', sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:3001',
      '/admin': 'http://localhost:3001',
      '/reports': 'http://localhost:3001',
      '/users': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
