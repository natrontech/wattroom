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

/**
 * #1516: the eager shell used to arrive as 122 modulepreload hints, 98 of them
 * under 2 KB. SvelteKit declares every route node as its own rolldown entry, so
 * Rolldown's default chunking splits shared code by exact entry-reference-set —
 * 72 entries produce a long tail of one-module chunks, and 122 separate gzip
 * streams cost 27 KB more than one. Rolldown's `$initial` tag cannot be used to
 * name the eager set for the same reason (it matches 4518 of 4534 modules), and
 * `experimentalMinChunkSize` is a Rollup option Rolldown ignores.
 *
 * So compute the eager set instead: the static-import closure of the three
 * modules the SPA fallback actually preloads — kit's client entry, the generated
 * app, and route node 0 (the root layout). `buildEnd` runs after the module
 * graph is complete and before chunk assignment, so the set is populated by the
 * time `codeSplitting.groups[].test` is consulted.
 */
function eagerShell(): { plugin: Plugin; contains: (id: string) => boolean } {
	const eager = new Set<string>();
	const isSeed = (id: string) =>
		id.endsWith('/client-optimized/app.js') ||
		id.endsWith('/kit/src/runtime/client/entry.js') ||
		id.endsWith('/client-optimized/nodes/0.js');

	return {
		contains: (id) => eager.has(id),
		plugin: {
			name: 'wattroom-eager-shell',
			applyToEnvironment: (environment) => environment.name === 'client',
			buildEnd() {
				eager.clear();
				const stack = [...this.getModuleIds()].filter(isSeed);
				if (stack.length === 0) {
					// Renamed upstream: the shell silently falls back to Rolldown's
					// default chunking, which is the 122-preload shape #1516 is about.
					this.warn('wattroom-eager-shell: no seed module matched');
				}
				while (stack.length > 0) {
					const id = stack.pop() as string;
					if (eager.has(id)) continue;
					eager.add(id);
					// Static imports only — a dynamic import is what makes a route lazy.
					for (const next of this.getModuleInfo(id)?.importedIds ?? [])
						stack.push(next);
				}
			},
		},
	};
}

const shell = eagerShell();

export default defineConfig({
	plugins: [
		hardwareLog(),
		shell.plugin,
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
	environments: {
		// Client only. The same grouping on the SSR build folds browser-only lib
		// code into a chunk `svelte-kit build`'s prerender pass evaluates, and it
		// dies with `ReferenceError: document is not defined`.
		client: {
			build: {
				rolldownOptions: {
					output: {
						codeSplitting: {
							groups: [
								{
									name: 'eager-vendor',
									test: (id) =>
										shell.contains(id) && id.includes('/node_modules/'),
								},
								{
									name: 'eager-app',
									test: (id) =>
										shell.contains(id) && !id.includes('/node_modules/'),
								},
							],
						},
					},
				},
			},
		},
	},
	test: {
		// e2e/*.spec.ts belongs to Playwright. Vitest's default **/*.spec.ts glob
		// picks those up otherwise and fails with "Playwright Test did not expect
		// test() to be called here" — which reads like a Playwright problem and is
		// not one. The specs only: the harness's own helpers live in e2e/ as well,
		// and a *.test.ts beside them is a plain unit test vitest should run
		// (e2e/env.test.ts, #2126).
		exclude: [
			'**/node_modules/**',
			'**/dist/**',
			'**/build/**',
			'e2e/**/*.spec.ts',
		],
		// No socket leaves a unit test (src/vitest.setup.ts).
		setupFiles: ['src/vitest.setup.ts'],
	},
	server: {
		// 5174 for humans; PORT lets agent harnesses run parallel instances.
		// `make dev-web` sets both PORT and WATTROOM_API from the checkout's
		// derived pair (scripts/dev-env.sh, #552) so the two always agree.
		port: Number(process.env.PORT) || 5174,
		proxy: {
			// Go backend during development (make dev). WS needs ws: true.
			// changeOrigin must stay OFF: the string shorthand turns it on, which
			// rewrites Host to :8080 while Origin stays :5174 — and the server's
			// same-origin check then 403s every PATCH /api/me and logout in dev.
			// WATTROOM_API points a worktree's Vite at its own server instance —
			// parallel agents can't all sit on :8080. `make dev-web` derives it
			// from the worktree path; unset, this is the main tree's :8080.
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
