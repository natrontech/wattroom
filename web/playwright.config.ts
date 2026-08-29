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
	webServer: {
		command: 'node e2e/server.js',
		url: 'http://localhost:4173/ride',
		reuseExistingServer: !process.env.CI,
		timeout: 60_000
	}
});
