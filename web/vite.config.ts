import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { appendFileSync, mkdirSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Dev-only sink for hardware-session telemetry (#10). The GATT log used to live in
 * page memory, so every HMR reload threw away the evidence from the ride that just
 * happened. Writing it to a file survives reloads, browser restarts and the rider
 * closing the laptop, and it can be read without touching the browser at all.
 */
function hardwareLog(): Plugin {
	return {
		name: 'wattroom-hardware-log',
		configureServer(server) {
			server.middlewares.use('/__hwlog', (req, res) => {
				if (req.method !== 'POST') {
					res.statusCode = 405;
					return res.end();
				}
				let body = '';
				req.on('data', (chunk) => (body += chunk));
				req.on('end', () => {
					try {
						mkdirSync('.hwlog', { recursive: true });
						appendFileSync('.hwlog/session.jsonl', `${body.trim()}\n`);
					} catch {
						// Logging must never take the dev server down mid-ride.
					}
					res.statusCode = 204;
					res.end();
				});
			});
		},
	};
}

export default defineConfig({
	plugins: [
		hardwareLog(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
			},

			// SPA mode: the Go server serves index.html as fallback for all routes.
			adapter: adapter({ fallback: 'index.html' }),
		}),
	],
	test: {
		// e2e/ belongs to Playwright. Vitest's default **/*.spec.ts glob picks it up
		// otherwise and fails with "Playwright Test did not expect test() to be
		// called here" — which reads like a Playwright problem and is not one.
		exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', 'e2e/**'],
	},
	server: {
		// 5174 for humans; PORT lets agent harnesses run parallel instances.
		port: Number(process.env.PORT) || 5174,
		proxy: {
			// Go backend during development (make dev). WS needs ws: true.
			// changeOrigin must stay OFF: the string shorthand turns it on, which
			// rewrites Host to :8080 while Origin stays :5174 — and the server's
			// same-origin check then 403s every PATCH /api/me and logout in dev.
			// WATTROOM_API points a worktree's Vite at its own server instance —
			// parallel agents can't all sit on :8080.
			'/api': {
				target: process.env.WATTROOM_API ?? 'http://localhost:8080',
				changeOrigin: false,
			},
			'/ws': {
				target: (process.env.WATTROOM_API ?? 'http://localhost:8080').replace(
					'http',
					'ws',
				),
				ws: true,
				changeOrigin: false,
			},
		},
	},
});
