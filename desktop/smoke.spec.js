// The shell's smoke test (#296).
//
// BLE and audio are not testable in CI at all, and the native chooser is not
// Playwright-drivable (RESEARCH.md §15.5) — so this asserts the things that
// *can* be checked mechanically, and the four handlers get a hardware session
// per OS instead. What is here is chosen for what breaks silently:
//
//   - the window opens at all,
//   - `window.wattroom` carries the keys ADR-0037 says the web app
//     feature-detects, because a renamed key degrades the app to browser
//     behaviour with no error anywhere,
//   - the navigation guard actually refuses another origin,
//   - the offline screen renders rather than a white rectangle.
//
// Run: `make desktop-smoke`. It points the shell at a URL that cannot resolve
// unless one is given, which is what exercises the offline path.
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');

/** A host that cannot resolve, so the shell lands on its offline screen. */
const DEAD_URL = 'http://localhost:1/';

async function launch(url) {
	return electron.launch({
		args: [path.join(__dirname, 'main.js')],
		env: { ...process.env, WATTROOM_URL: url },
	});
}

test('the window opens and the bridge carries what the app looks for', async () => {
	const app = await launch(DEAD_URL);
	const win = await app.firstWindow();
	// The first load fails and the shell navigates to its offline screen, so
	// evaluating before that settles races the navigation.
	await expect(win.locator('#retry')).toBeVisible();

	// ADR-0037: the web app feature-detects `window.wattroom?.…`. These are the
	// names it detects, so renaming one is a breaking change to that contract.
	const bridge = await win.evaluate(() => ({
		present: typeof window.wattroom === 'object' && window.wattroom !== null,
		keys: Object.keys(window.wattroom ?? {}).sort(),
		platform: window.wattroom?.platform,
		version: window.wattroom?.version,
	}));
	expect(bridge.present).toBe(true);
	expect(bridge.keys).toEqual(['platform', 'retry', 'version']);
	expect(bridge.platform).toBe(process.platform);
	// Not Electron's version. app.getVersion() returns Electron's when
	// unpackaged, so this asserts the shell's own — the number the update
	// check compares against the newest release tag.
	expect(bridge.version).toBe(require('./package.json').version);

	// Remote content must not reach Node through the bridge.
	const leaked = await win.evaluate(
		() => typeof require !== 'undefined' || typeof process !== 'undefined',
	);
	expect(leaked, 'node reachable from the renderer').toBe(false);

	await app.close();
});

test('an unreachable app renders the offline screen, not a blank window', async () => {
	const app = await launch(DEAD_URL);
	const win = await app.firstWindow();

	// errors.md: never blank, and recovery is one big button.
	await expect(win.locator('h1')).toHaveText(/can’t be reached/i);
	await expect(win.locator('#retry')).toBeVisible();
	expect(await win.locator('#target').textContent()).toContain(DEAD_URL);

	await app.close();
});

test('the navigation guard refuses another origin', async () => {
	const app = await launch(DEAD_URL);
	const win = await app.firstWindow();
	await expect(win.locator('#retry')).toBeVisible();

	// A redirect to somewhere else is the shape that hands remote content the
	// shell's permissions; will-navigate has to refuse it and the window has to
	// stay where it was.
	const before = win.url();
	await win.evaluate(() => {
		window.location.href = 'https://example.com/';
	});
	await new Promise((r) => setTimeout(r, 1500));
	expect(win.url()).toBe(before);
	expect(win.url()).not.toContain('example.com');

	await app.close();
});
