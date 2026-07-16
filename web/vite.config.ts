import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// SPA mode: the Go server serves index.html as fallback for all routes.
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	server: {
		proxy: {
			// Go backend during development (make dev). WS needs ws: true.
			'/api': 'http://localhost:8080',
			'/ws': { target: 'ws://localhost:8080', ws: true }
		}
	}
});
