import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Dev: the API runs separately (npm run dev -w @fpc/api). In production Fastify serves both.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
