import { defineConfig, devices } from '@playwright/test';

/**
 * One end-to-end flow (WATTROOM.md): simulated trainer rides a workout and produces
 * a .fit. It exercises the seam nothing else covers — browser ride loop, real
 * workout engine, HTTP, and the Go encoder — so it is deliberately the only e2e
 * test rather than the first of many.
 *
 * Chromium only: Web Bluetooth exists nowhere else, and the app says so itself.
 */
export default defineConfig({
	testDir: 'e2e',
	// The smoke rides two real minutes; the default 30 s cap would kill it.
	timeout: 5 * 60 * 1000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	// Serves the built SPA and proxies /api to the Go server, matching production.
	//
	// Always builds, never reuses: the server only ever serves build/, so a reused
	// process happily serves a stale bundle and the run passes against code that is
	// not the code under test. A route added since the last build 404s — which is
	// exactly how this was found. The build costs seconds against a two-minute ride.
	webServer: {
		command: 'pnpm build && node e2e/server.js',
		url: 'http://localhost:4173/ride',
		reuseExistingServer: false,
		timeout: 120_000
	}
});
