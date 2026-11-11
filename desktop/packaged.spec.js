// The packaged shell, driven over CDP (#1314, ADR-0088).
//
// smoke.spec.js launches the shell from source through Playwright's
// _electron, which attaches through the main process's --inspect. A packaged
// build has that switched off by its fuses (#3009), so this test cannot use
// it: it launches the built binary itself, with Chromium's
// --remote-debugging-port, and drives the windows the way a second program
// would, through chromium.connectOverCDP. Nothing here reaches into the main
// process — what it sees is what a rider's build does.
//
// Against a real server (web/e2e/server.js: the production web build, the Go
// API, Postgres) it does what a rider does on the first day:
//
//   - signs in through the browser hand-off (ADR-0040): the shell's page
//     opens /login?desktop=<nonce>, "the browser" (this test) signs in and
//     mints the token, and a SECOND launch of the binary carries
//     wattroom://auth/<token> to the first through the single-instance lock,
//   - rides the hidden one-minute workout on the SimulatedTrainer to its
//     summary, with the ride saved on the server,
//   - and sees the HUD open on the app's origin while riding and close after.
//
// Run: it needs a built app and a server. CI does both (desktop.yml's
// `packaged` job, desktop-release.yml's `ride` job on the signed build):
//
//   WATTROOM_APP_BINARY=dist/linux-unpacked/wattroom-desktop \
//   WATTROOM_URL=http://localhost:4467 \
//   xvfb-run pnpm exec playwright test -c packaged.config.js
//
// Never on a desk with a visible window: the shell draws one, and so does the
// browser the hand-off opens.
const { test, expect, chromium, request } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BINARY = process.env.WATTROOM_APP_BINARY;
const APP_URL = process.env.WATTROOM_URL;
// One rider per run's purpose, reused (e2e/signin.ts): a fresh name per run
// would grow the user table forever. Letters and spaces: the dev door's rule.
const RIDER = 'Packaged Shell';

/** Start the built shell. `extra` goes after the switches every launch shares. */
function start(userData, extra = []) {
	const child = spawn(BINARY, [`--user-data-dir=${userData}`, ...extra], {
		env: {
			...process.env,
			WATTROOM_URL: APP_URL,
			// Launch at login writes into XDG_CONFIG_HOME on Linux (#1313).
			XDG_CONFIG_HOME: path.join(userData, 'config'),
			// The hand-off sends the rider to the system browser; on a Linux
			// runner xdg-open honours $BROWSER, and `true` opens nothing.
			BROWSER: 'true',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	child.output = '';
	for (const stream of [child.stdout, child.stderr])
		stream.on('data', (chunk) => {
			child.output += chunk;
		});
	return child;
}

/** The CDP port Chromium prints once it listens: `DevTools listening on ws://…`. */
async function devtoolsPort(child) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const match = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(child.output);
		if (match) return Number(match[1]);
		if (child.exitCode !== null)
			throw new Error(`the shell exited ${child.exitCode}:\n${child.output}`);
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(`no DevTools port in 30 s:\n${child.output}`);
}

/** The rider's window, once it has loaded something from the app's origin. */
async function appWindow(browser) {
	let found;
	await expect
		.poll(
			() => {
				found = browser
					.contexts()
					.flatMap((c) => c.pages())
					.find((p) => p.url().startsWith(APP_URL));
				return Boolean(found);
			},
			{ timeout: 30_000, message: `a window on ${APP_URL}` },
		)
		.toBe(true);
	return found;
}

const hudOpen = (browser) =>
	browser
		.contexts()
		.flatMap((c) => c.pages())
		.some((p) => p.url().startsWith(`${APP_URL}/hud`));

test('the packaged shell signs in through the hand-off, rides the simulated trainer and floats the HUD', async () => {
	test.skip(!BINARY || !APP_URL, 'needs WATTROOM_APP_BINARY and WATTROOM_URL');
	// A real minute of riding, plus a cold launch and the save.
	test.setTimeout(5 * 60 * 1000);
	const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wattroom-packaged-'));
	// Port 0: Chromium picks a free one and prints it.
	const shell = start(userData, ['--remote-debugging-port=0']);
	let browser;
	try {
		browser = await chromium.connectOverCDP(
			`http://127.0.0.1:${await devtoolsPort(shell)}`,
		);

		// ── It launches, and the page sees a shell ─────────────────────────
		const win = await appWindow(browser);
		const bridge = await win.evaluate(() => ({
			version: window.wattroom?.version,
			platform: window.wattroom?.platform,
		}));
		expect(bridge).toEqual({
			version: require('./package.json').version,
			platform: process.platform,
		});
		// Mute (AGENTS.md) and the flat surface: a runner has no speakers and no GPU.
		await win.evaluate(() => {
			localStorage.setItem(
				'wattroom.mixer.v1',
				JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
			);
			localStorage.setItem('wattroom.world.mode.v1', 'flat');
		});

		// ── Sign-in through the browser (ADR-0040) ─────────────────────────
		await win.goto(`${APP_URL}/login`);
		await win.getByRole('button', { name: 'Sign in with your browser' }).click();
		const nonce = await win.evaluate(() =>
			localStorage.getItem('wattroom.desktop-signin.v1'),
		);
		expect(nonce).toMatch(/^[A-Za-z0-9_-]{16,128}$/);

		// The browser half: sign in there, mint the token for that nonce.
		const browserSide = await request.newContext({ baseURL: APP_URL });
		const signedIn = await browserSide.get(
			`/api/auth/dev/start?as=${encodeURIComponent(RIDER)}`,
		);
		expect(signedIn.ok(), await signedIn.text()).toBe(true);
		const handoff = await browserSide.post('/api/auth/desktop/handoff', {
			headers: { Origin: APP_URL },
			data: { nonce },
		});
		expect(handoff.status(), await handoff.text()).toBe(200);
		const { token } = await handoff.json();
		await browserSide.dispose();

		// What the OS does with wattroom://: launch the app again with the link.
		// The single-instance lock hands it to the running shell and quits.
		const second = start(userData, [`wattroom://auth/${token}`]);
		const exited = await new Promise((done) => {
			const timer = setTimeout(() => done(null), 30_000);
			second.on('exit', (code) => {
				clearTimeout(timer);
				done(code);
			});
		});
		expect(exited, `the second launch did not hand over and quit:\n${second.output}`).toBe(0);
		await expect
			.poll(
				() =>
					win.evaluate(() =>
						fetch('/api/me')
							.then((r) => (r.ok ? r.json() : null))
							.then((me) => me?.displayName ?? null)
							.catch(() => null),
					),
				{ timeout: 30_000, message: 'the shell signed in from the hand-off' },
			)
			.toBe(RIDER);

		// ── A ride on the SimulatedTrainer ─────────────────────────────────
		// ?w= resolves the hidden one-minute CI fixture (web/e2e/ride.spec.ts).
		await win.goto(`${APP_URL}/ride?w=smoke-test`);
		await expect(win.getByRole('heading', { name: 'Smoke Test' })).toBeVisible({
			timeout: 30_000,
		});
		expect(hudOpen(browser)).toBe(false);
		await win.getByRole('button', { name: 'Ride simulated' }).first().click();
		const trainerCard = win.getByText('Simulated Trainer').locator('..');
		await expect(trainerCard.getByText(/\d+ W · \d+ rpm/)).toBeVisible({
			timeout: 15_000,
		});
		await win.getByRole('button', { name: 'Start the ride' }).click();

		// The clock moves: a frozen session still renders numbers.
		const clock = win.getByTestId('ride-clock');
		const firstClock = await clock.innerText();
		await expect(clock).not.toHaveText(firstClock, { timeout: 15_000 });

		// The HUD is its own window on our origin, opened by the ride (ADR-0041).
		await expect
			.poll(() => hudOpen(browser), { timeout: 15_000, message: 'the HUD opened' })
			.toBe(true);

		// Ride it out: 65 s of workout and slack for a loaded runner.
		await expect(win.getByTestId('download-fit')).toBeVisible({ timeout: 150_000 });
		const saved = win.getByRole('link', { name: 'See your ride' });
		await expect(saved).toBeVisible({ timeout: 15_000 });
		await expect
			.poll(() => hudOpen(browser), { timeout: 15_000, message: 'the HUD closed' })
			.toBe(false);

		// The server kept it, as this rider's.
		await saved.click();
		await expect(win).toHaveURL(/\/history\/[^/]+$/);
		await expect(win.getByText('Smoke Test').first()).toBeVisible({
			timeout: 15_000,
		});
	} finally {
		await browser?.close().catch(() => {});
		shell.kill();
		await test.info().attach('shell output', { body: shell.output });
	}
});
