import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const envDir = fileURLToPath(new URL('..', import.meta.url));
    const { API_PORT = '3000' } = loadEnv(mode, envDir, 'API_');
    const proxy = { '/api': `http://127.0.0.1:${API_PORT}` };
    return {
        envDir,
        plugins: [react(), tailwindcss()],
        server: { proxy, strictPort: true },
        preview: { proxy, strictPort: true },
    };
});
