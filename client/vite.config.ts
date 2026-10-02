import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.API_PROXY_TARGET || 'http://127.0.0.1:3000';
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    envDir: process.cwd(),
    plugins: [react(), tailwindcss()],
    server: { host: '0.0.0.0', port: 5173, strictPort: true, proxy: {
      '/api': { target }, '/socket.io': { target, ws: true },
    } },
    build: { outDir: '../dist/client', emptyOutDir: true },
  };
});
