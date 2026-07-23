import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // during local dev, proxy /api calls to `vercel dev` or `netlify dev`
    // (run one of those alongside `npm run dev`, see README)
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
