import { defineConfig, devices } from '@playwright/test';

// Ports come from scripts/dev-env.sh, so a run in a worktree neither binds nor
// probes the main tree's (e2e/env.js). PLAYWRIGHT_BASE_URL points the suite at
// a deployed target instead of a local build.
import { baseUrl, isExternal } from './e2e/env.js';

const external = isExternal();

/**
 * A handful of smoke flows: a simulated ride to a .fit, first run, two riders
 * in one session, chat, and the public pages. Chromium only: Web Bluetooth
 * exists nowhere else.
 */
export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.spec.ts',
	// The ride spec rides a real minute; the default 30 s cap would kill it.
	timeout: 5 * 60 * 1000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	workers: process.env.CI ? 3 : undefined,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: baseUrl(),
		trace: 'retain-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				launchOptions: { args: ['--mute-audio'] },
			},
		},
	],
	webServer: external
		? undefined
		: {
				command: 'pnpm build && node e2e/server.js',
				url: `${baseUrl()}/ride`,
				reuseExistingServer: false,
				timeout: 120_000,
			},
});
