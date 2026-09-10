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
const fs = require('node:fs');
const os = require('node:os');

/**
 * Nothing listens here, so the shell lands on its offline screen.
 *
 * A high unused port on purpose: port 1 is on Chromium's restricted list, so
 * it fails with ERR_UNSAFE_PORT — which is a blocked port, not a server that
 * is down. Both reach did-fail-load and the test passed either way, but the
 * scenario this claims to cover is "the app did not answer", and that is
 * ERR_CONNECTION_REFUSED.
 */
const DEAD_URL = 'http://localhost:45999/';

async function launch(url, userData = null) {
	// Its own userData directory, which is what the single-instance lock is
	// keyed on. Without this the lock is shared by every checkout on the
	// machine, so `make desktop` running in one worktree makes a smoke run in
	// another quit on startup — the same collision #552 fixed for ports and
	// databases, and this repo runs worktrees in parallel by design. A test
	// that relaunches passes the same directory back in (#1948).
	userData ??= fs.mkdtempSync(path.join(os.tmpdir(), 'wattroom-smoke-'));
	const app = await electron.launch({
		args: [path.join(__dirname, 'main.js'), `--user-data-dir=${userData}`],
		env: { ...process.env, WATTROOM_URL: url },
	});
	app.userData = userData;
	return app;
}

test('the window comes back where it was, unless that is off every display', async () => {
	const first = await launch(DEAD_URL);
	const win = await first.firstWindow();
	await expect(win.locator('#retry')).toBeVisible();
	await first.evaluate(({ BrowserWindow }) => {
		const [w] = BrowserWindow.getAllWindows();
		w.setBounds({ x: 40, y: 60, width: 900, height: 700 });
	});
	const dir = first.userData;
	await first.close();
	const saved = JSON.parse(
		fs.readFileSync(path.join(dir, 'window.json'), 'utf8'),
	);
	expect(saved).toMatchObject({ width: 900, height: 700, maximized: false });

	const second = await launch(DEAD_URL, dir);
	await expect((await second.firstWindow()).locator('#retry')).toBeVisible();
	const bounds = await second.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].getBounds(),
	);
	expect([bounds.width, bounds.height]).toEqual([900, 700]);
	await second.close();

	// A position off every display keeps the size and drops the position.
	fs.writeFileSync(
		path.join(dir, 'window.json'),
		JSON.stringify({
			x: 99999,
			y: 99999,
			width: 800,
			height: 600,
			maximized: false,
		}),
	);
	const third = await launch(DEAD_URL, dir);
	await expect((await third.firstWindow()).locator('#retry')).toBeVisible();
	const placed = await third.evaluate(({ BrowserWindow, screen }) => {
		const b = BrowserWindow.getAllWindows()[0].getBounds();
		const on = screen
			.getAllDisplays()
			.some(
				({ workArea: a }) =>
					b.x < a.x + a.width &&
					b.x + b.width > a.x &&
					b.y < a.y + a.height &&
					b.y + b.height > a.y,
			);
		return { on, width: b.width, height: b.height };
	});
	expect(placed).toEqual({ on: true, width: 800, height: 600 });
	await third.close();
});

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
		titleBar: window.wattroom?.titleBar,
	}));
	expect(bridge.present).toBe(true);
	expect(bridge.keys).toEqual([
		'hud',
		'installUpdate',
		'keepAwake',
		'notify',
		'onBleScan',
		'onNotification',
		'onUpdate',
		'pickDevice',
		'platform',
		'retry',
		'titleBar',
		'version',
	]);
	// The strip the app draws where the OS title bar was (#1188): a number,
	// or the app draws nothing and the traffic lights land on the sidebar.
	expect(bridge.titleBar).toBe(32);
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

	// Stub the external open in the MAIN process. Two reasons, and the second
	// is why this test failed in CI before: most of the app's outbound links
	// carry no target=_blank, so they arrive at will-navigate and handing them
	// to the real browser is the correct behaviour — but on a headless runner
	// shell.openExternal spawns xdg-open, which kept Electron alive and hung
	// app.close() until the worker teardown timed out. Stubbing also lets this
	// assert the half that matters most: the URL did not merely fail to load,
	// it went to the browser instead.
	await app.evaluate(({ shell }) => {
		globalThis.__opened = [];
		shell.openExternal = async (url) => {
			globalThis.__opened.push(url);
		};
	});

	const before = win.url();
	await win.evaluate(() => {
		window.location.href = 'https://example.com/';
	});
	await new Promise((r) => setTimeout(r, 1500));

	// Blocked in the shell...
	expect(win.url()).toBe(before);
	expect(win.url()).not.toContain('example.com');
	// ...and handed to the browser rather than silently dropped, which would
	// leave every external link in the app dead.
	const opened = await app.evaluate(() => globalThis.__opened);
	expect(opened).toEqual(['https://example.com/']);

	await app.close();
});

/**
 * The chooser's own rules (#1545, #1716), which is the half of
 * `select-bluetooth-device` that CI *can* prove: no radio here, only the
 * state machine that decides when a scan is answered and what the app is
 * told. Both of its rules have broken in production — one shipped a shell
 * that could not pair anything at all.
 */
test('the Bluetooth chooser holds the scan open and streams it to the app', async () => {
	const app = await launch(DEAD_URL);
	await app.firstWindow();

	const seen = await app.evaluate(
		async ({ BrowserWindow, dialog, ipcMain }) => {
			// If the handshake below ever stops working this takes the native
			// fallback, and an un-stubbed message box would hang the run for a
			// minute instead of failing.
			dialog.showMessageBox = async () => ({ response: 1 });

			const win = BrowserWindow.getAllWindows()[0];
			// What the preload does on load: registering onBleScan is the app
			// saying it can draw the picker itself.
			ipcMain.emit('wattroom:ble-picker-ready');

			const sent = [];
			const pass = win.webContents.send.bind(win.webContents);
			win.webContents.send = (channel, payload) => {
				if (channel === 'wattroom:ble-scan') sent.push(payload);
				else pass(channel, payload);
			};

			const answers = [];
			const scan = (devices) =>
				win.webContents.emit(
					'select-bluetooth-device',
					{ preventDefault() {} },
					devices,
					(deviceId) => answers.push(deviceId),
				);

			// Electron emits the moment the scan starts — ~130 ms in, before
			// anything can have advertised — then again per device heard.
			scan([]);
			scan([{ deviceId: 'a', deviceName: 'KICKR CORE 8F2A' }]);
			scan([
				{ deviceId: 'a', deviceName: 'KICKR CORE 8F2A' },
				{ deviceId: 'b', deviceName: '' },
			]);
			const answeredWhileScanning = answers.length;

			ipcMain.emit('wattroom:ble-pick', {}, 'a');
			// A late answer from a picker whose request is over must not settle
			// the next one.
			ipcMain.emit('wattroom:ble-pick', {}, 'b');
			return { sent, answeredWhileScanning, answers };
		},
	);

	// Answering that first empty list is a cancel: the shell shipped unable
	// to pair anything at all that way (#1545).
	expect(seen.answeredWhileScanning).toBe(0);
	expect(seen.sent).toEqual([
		[],
		[{ id: 'a', name: 'KICKR CORE 8F2A' }],
		[
			{ id: 'a', name: 'KICKR CORE 8F2A' },
			// A device that advertises no name is offered by its id rather
			// than as a blank row nobody can tell apart.
			{ id: 'b', name: 'b' },
		],
		// The shell closes the picker when it has its answer.
		null,
	]);
	expect(seen.answers).toEqual(['a']);
	await app.close();
});

test('a wattroom://auth link loads the handoff on our origin, and nothing else does', async () => {
	const app = await launch(DEAD_URL);
	const win = await app.firstWindow();
	await expect(win.locator('#retry')).toBeVisible();

	// loadURL from main fires no will-navigate, so watch the navigation itself.
	await app.evaluate(({ BrowserWindow }) => {
		globalThis.__nav = [];
		const [w] = BrowserWindow.getAllWindows();
		w.webContents.on('did-start-navigation', (e) => {
			if (e.isMainFrame) globalThis.__nav.push(e.url);
		});
	});
	const emit = (link) =>
		app.evaluate(
			({ app }, l) => app.emit('open-url', { preventDefault() {} }, l),
			link,
		);

	// Not ours, and not the auth path: dropped, no navigation.
	await emit('https://example.com/login?handoff=abcdefghijklmnopqrstuvwxyz');
	await emit('wattroom://evil/abcdefghijklmnopqrstuvwxyz');
	await emit('wattroom://auth/short');
	await emit('wattroom://auth/has%20space%20and%20more%20chars');
	await new Promise((r) => setTimeout(r, 500));
	expect(await app.evaluate(() => globalThis.__nav)).toEqual([]);

	// The real thing: /login?handoff=<token> on the app's origin, never the
	// link's own host.
	await emit('wattroom://auth/abcdefghijklmnopqrstuvwxyz0123456789');
	await new Promise((r) => setTimeout(r, 1500));
	const nav = await app.evaluate(() => globalThis.__nav);
	expect(nav[0]).toBe(
		`${DEAD_URL.replace(/\/$/, '')}/login?handoff=abcdefghijklmnopqrstuvwxyz0123456789`,
	);

	await app.close();
});

test('the HUD is a second window on our origin, opened and closed by the app', async () => {
	const app = await launch(DEAD_URL);
	const win = await app.firstWindow();
	await expect(win.locator('#retry')).toBeVisible();
	// Taken while it is the only window: getAllWindows() has no order.
	const mainId = await app.evaluate(
		({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id,
	);

	await app.evaluate(({ app }) => {
		globalThis.__hudNav = [];
		app.on('browser-window-created', (_e, w) =>
			w.webContents.on('did-start-navigation', (e) => {
				if (e.isMainFrame) globalThis.__hudNav.push(e.url);
			}),
		);
	});
	await win.evaluate(() => window.wattroom.hud(true));
	await new Promise((r) => setTimeout(r, 1500));
	const windows = await app.evaluate(
		({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
	);
	expect(windows).toBe(2);
	// /hud on the app's origin, in the same session.
	expect(await app.evaluate(() => globalThis.__hudNav)).toEqual([
		`${DEAD_URL.replace(/\/$/, '')}/hud`,
	]);
	// Idempotent: a second open does not stack windows.
	await win.evaluate(() => window.wattroom.hud(true));
	await new Promise((r) => setTimeout(r, 300));
	expect(
		await app.evaluate(
			({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
		),
	).toBe(2);
	// The HUD's own renderer runs the app's layout, which reports no ride
	// there (#1938): a hud(false) from THAT window must not close it.
	await app.evaluate(async ({ BrowserWindow }, first) => {
		const hud = BrowserWindow.getAllWindows().find((w) => w.id !== first);
		await hud.webContents.executeJavaScript('window.wattroom.hud(false)');
	}, mainId);
	await new Promise((r) => setTimeout(r, 500));
	expect(
		await app.evaluate(
			({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
		),
	).toBe(2);

	await win.evaluate(() => window.wattroom.hud(false));
	await new Promise((r) => setTimeout(r, 500));
	expect(
		await app.evaluate(
			({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
		),
	).toBe(1);

	await app.close();
});

test('a ride holds the machine awake, and stops holding it', async () => {
	const app = await launch(DEAD_URL);
	const win = await app.firstWindow();
	await expect(win.locator('#retry')).toBeVisible();

	const blocking = () =>
		app.evaluate(
			({ powerSaveBlocker }) =>
				powerSaveBlocker.isStarted(0) ||
				// ids are sequential from 0; any started blocker is ours, since
				// the shell starts no other.
				[1, 2, 3].some((id) => powerSaveBlocker.isStarted(id)),
		);

	// Nothing is riding yet.
	expect(await blocking()).toBe(false);

	// workout/wakelock.ts calls exactly this for a ride's duration.
	await win.evaluate(() => window.wattroom.keepAwake(true));
	await expect.poll(blocking).toBe(true);

	// And releases it when the ride ends — a blocker left running is a laptop
	// that never sleeps again until quit.
	await win.evaluate(() => window.wattroom.keepAwake(false));
	await expect.poll(blocking).toBe(false);

	await app.close();
});

test('the native fallback still pairs a web app too old to draw the picker', async () => {
	// #1545: Electron emits `select-bluetooth-device` the moment the scan
	// starts, before anything has advertised, and again for every device it
	// hears. Answering that first list with '' cancels the request — which is
	// how the shell shipped unable to pair a trainer at all. The event is a
	// plain EventEmitter emit, so the handler can be exercised without a radio.
	//
	// This is now the path taken when the loaded app never registered
	// onBleScan (#1716) — the shell and the app release on separate trains,
	// and the offline screen this launches on is exactly such an app.
	const app = await launch(DEAD_URL);
	const win = await app.firstWindow();
	await expect(win.locator('#retry')).toBeVisible();

	const emit = (devices) =>
		app.evaluate(async ({ BrowserWindow, dialog }, list) => {
			dialog.showMessageBox = async (_win, options) => {
				globalThis.__buttons = options.buttons;
				return { response: 0 };
			};
			const { webContents } = BrowserWindow.getAllWindows()[0];
			return await new Promise((resolve) => {
				const held = setTimeout(() => resolve('held'), 1500);
				webContents.emit(
					'select-bluetooth-device',
					{ preventDefault() {} },
					list,
					(deviceId) => {
						clearTimeout(held);
						resolve(`answered:${deviceId}`);
					},
				);
			});
		}, devices);

	// The launch warm-up (warmBluetooth) is a Bluetooth request of our own, and
	// the handler answers it rather than showing a picker. Wait it out first, or
	// this test reads its answer as the bug.
	await expect.poll(() => emit([]), { timeout: 15_000 }).toBe('held');

	// A device turns up mid-scan: the message box opens on the list as it is
	// now, and the chooser is answered with what the rider pressed.
	expect(
		await emit([{ deviceId: 'kickr-1', deviceName: 'KICKR CORE 1234' }]),
	).toBe('answered:kickr-1');
	expect(await app.evaluate(() => globalThis.__buttons)).toEqual([
		'KICKR CORE 1234',
		'Cancel',
	]);

	await app.close();
});
