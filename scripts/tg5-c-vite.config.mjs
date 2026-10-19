// Isolated local acceptance preview: no project .env files or business endpoints.
import { fileURLToPath } from 'node:url';
export default {
  envDir: fileURLToPath(new URL('./fixtures/tg5-empty-env', import.meta.url)),
  esbuild: { jsx: 'automatic' },
  define: {
    'import.meta.env.VITE_SUPPORT_MOCK': JSON.stringify('1'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fixture.invalid'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('fixture'),
  },
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
};
