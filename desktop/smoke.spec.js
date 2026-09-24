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

async function launch(url, userData = null, extraArgs = []) {
	// Its own userData directory, which is what the single-instance lock is
	// keyed on. Without this the lock is shared by every checkout on the
	// machine, so `make desktop` running in one worktree makes a smoke run in
	// another quit on startup — the same collision #552 fixed for ports and
	// databases, and this repo runs worktrees in parallel by design. A test
	// that relaunches passes the same directory back in (#1948).
	userData ??= fs.mkdtempSync(path.join(os.tmpdir(), 'wattroom-smoke-'));
	// And its own XDG config root, because launch-at-login on Linux is a file
	// in ~/.config/autostart (#1313). A test that wrote the real one would add
	// WattRoom to the login items of whoever ran it.
	const config = path.join(userData, 'config');
	const app = await electron.launch({
		args: [
			path.join(__dirname, 'main.js'),
			`--user-data-dir=${userData}`,
			...extraArgs,
		],
		env: { ...process.env, WATTROOM_URL: url, XDG_CONFIG_HOME: config },
	});
	app.userData = userData;
	app.autostartFile = path.join(config, 'autostart', 'wattroom.desktop');
	return app;
}

/** The tray's menu as it stands, by label — its click handlers stay in main. */
function trayLabels(app) {
	return app.evaluate(() =>
		process.mainModule
			.require('./tray')
			.menuTemplate()
			.map((item) => (item.type === 'separator' ? '---' : item.label)),
	);
}

/** Press a tray item by label, in the main process, as a rider would. */
function clickTray(app, label, checked = undefined) {
	return app.evaluate((_electron, [wanted, box]) => {
		const item = process.mainModule
			.require('./tray')
			.menuTemplate()
			.find((i) => i.label === wanted);
		if (!item) throw new Error(`no tray item "${wanted}"`);
		item.click({ checked: box });
	}, [label, checked]);
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
		'launchAtLogin',
		'notify',
		'onBleScan',
		'onHandoff',
		'onNavigate',
		'onNotification',
		'onUpdate',
		'pickDevice',
		'platform',
		'retry',
		'setLaunchAtLogin',
		'setRoom',
		'titleBar',
		'updateFailed',
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

test('a wattroom://auth link is handed to the page after a sign-in started here, and nothing else is', async () => {
	const app = await launch(DEAD_URL);
	const win = await app.firstWindow();
	await expect(win.locator('#retry')).toBeVisible();

	// Nothing may navigate the window (#1941): the token travels over IPC.
	await app.evaluate(({ BrowserWindow, shell }) => {
		globalThis.__nav = [];
		shell.openExternal = async () => {};
		const [w] = BrowserWindow.getAllWindows();
		w.webContents.on('did-start-navigation', (e) => {
			if (e.isMainFrame) globalThis.__nav.push(e.url);
		});
	});
	await win.evaluate(() => {
		window.__handoff = [];
		window.wattroom.onHandoff((token) => window.__handoff.push(token));
	});
	const emit = (link) =>
		app.evaluate(
			({ app }, l) => app.emit('open-url', { preventDefault() {} }, l),
			link,
		);
	const token = 'abcdefghijklmnopqrstuvwxyz0123456789';

	// A well-formed link with no sign-in started from this app: dropped.
	await emit(`wattroom://auth/${token}`);
	await new Promise((r) => setTimeout(r, 300));
	expect(await win.evaluate(() => window.__handoff)).toEqual([]);

	// The app sends the rider to the browser to sign in…
	await win.evaluate(
		(origin) => {
			window.open(`${origin}/login?desktop=nonce`, '_blank');
		},
		DEAD_URL.replace(/\/$/, ''),
	);
	// …and only then is a link accepted — the good one, never the others.
	await emit('https://example.com/login?handoff=abcdefghijklmnopqrstuvwxyz');
	await emit('wattroom://evil/abcdefghijklmnopqrstuvwxyz');
	await emit('wattroom://auth/short');
	await emit('wattroom://auth/has%20space%20and%20more%20chars');
	await emit(`wattroom://auth/${token}`);
	await new Promise((r) => setTimeout(r, 500));
	expect(await win.evaluate(() => window.__handoff)).toEqual([token]);
	expect(await app.evaluate(() => globalThis.__nav)).toEqual([]);

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
	// The app stays an app while the HUD floats (#2660). Floating it over
	// full-screen apps used to turn the whole process into a UI element: no
	// Dock icon, no ⌘-Tab, no menu bar — and a main window behind anything
	// else was then out of reach until the rider quit mid-ride.
	if (process.platform === 'darwin')
		expect(await app.evaluate(({ app }) => app.dock.isVisible())).toBe(true);
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
	// It sits in the corner nothing else claims (#1669). The HUD is
	// alwaysOnTop and shows while the main window is NOT in front — which is
	// exactly the TV-on-the-wall case — so where it lands is the only thing
	// keeping it off the YouTube player TV mode seats top-right. It used to
	// land top-right too, roughly 280×115 px of the player underneath it, and
	// nothing in the page could move an OS window.
	const seated = await app.evaluate(({ BrowserWindow, screen }, first) => {
		const hud = BrowserWindow.getAllWindows().find((w) => w.id !== first);
		const main = BrowserWindow.fromId(first);
		return {
			hud: hud.getBounds(),
			work: screen.getDisplayMatching(main.getBounds()).workArea,
		};
	}, mainId);
	const { hud, work } = seated;
	// The rectangles do not meet — asserted FIRST, because it is the thing
	// that matters and a corner check failing first would say "16, got 3104"
	// about a rule nobody would remember the reason for. TV mode's seat is
	// `top-[3vh] right-[3vw]`, `w-[24vw] min-w-[240px]`, 16:9 — against the
	// viewport, which on the display this is about is the work area within a
	// window chrome's worth.
	const seatWidth = Math.max(240, work.width * 0.24);
	const seat = {
		x: work.x + work.width - work.width * 0.03 - seatWidth,
		y: work.y + work.height * 0.03,
		width: seatWidth,
		height: (seatWidth * 9) / 16,
	};
	const overlaps =
		hud.x < seat.x + seat.width &&
		seat.x < hud.x + hud.width &&
		hud.y < seat.y + seat.height &&
		seat.y < hud.y + hud.height;
	expect(
		overlaps,
		`the HUD at ${JSON.stringify(hud)} covers TV mode's player seat at ${JSON.stringify(seat)} — YouTube's terms forbid anything over the player`,
	).toBe(false);
	// And it is in the corner on purpose, not merely somewhere clear.
	expect(hud.x).toBe(work.x + 16);
	expect(hud.y).toBe(work.y + work.height - hud.height - 16);

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

	// A Dock click with the HUD up brings the rider's window back (#2660).
	// macOS counts the HUD as a visible window and restores nothing itself.
	const restored = await app.evaluate(async ({ app, BrowserWindow }, first) => {
		const main = BrowserWindow.fromId(first);
		main.minimize();
		await new Promise((r) => setTimeout(r, 500));
		app.emit('activate', {}, true);
		await new Promise((r) => setTimeout(r, 500));
		return !main.isMinimized();
	}, mainId);
	expect(restored).toBe(true);

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

/**
 * The tray (#1313). Its menu is the whole interface on Linux — AppIndicator
 * has no click event — so what is in it, and whether pressing an item does
 * anything, is what there is to assert. The icon itself is not readable from
 * here; a hardware session per OS is what says it looks right in a menu bar.
 */
test('the tray offers the window, the room the app is in, and quit', async () => {
	const app = await launch(DEAD_URL);
	const win = await app.firstWindow();
	await expect(win.locator('#retry')).toBeVisible();

	// No room yet: the item is absent rather than dead, because pressing it
	// would open a window on the app's home and look like nothing happened.
	expect(await trayLabels(app)).toEqual([
		'Open WattRoom',
		'---',
		'Launch at login',
		'---',
		'Quit WattRoom',
	]);

	// The app reports the room it is connected to.
	await win.evaluate(() =>
		window.wattroom.setRoom({ path: '/r/tuesday', name: 'Tuesday Night' }),
	);
	await expect.poll(() => trayLabels(app)).toContain('Open Tuesday Night');

	// Pressing it hands the page a path (a navigation would reload the SPA and
	// drop a ride's socket), and nothing navigates.
	await app.evaluate(({ BrowserWindow }) => {
		globalThis.__nav = [];
		BrowserWindow.getAllWindows()[0].webContents.on(
			'did-start-navigation',
			(e) => {
				if (e.isMainFrame) globalThis.__nav.push(e.url);
			},
		);
	});
	await win.evaluate(() => {
		window.__go = [];
		window.wattroom.onNavigate((to) => window.__go.push(to));
	});
	await clickTray(app, 'Open Tuesday Night');
	await expect
		.poll(() => win.evaluate(() => window.__go))
		.toEqual(['/r/tuesday']);
	expect(await app.evaluate(() => globalThis.__nav)).toEqual([]);

	// Remote content chooses the words, never where the app goes: a path off
	// our own root is refused, and the item goes away with it.
	await win.evaluate(() =>
		window.wattroom.setRoom({ path: 'https://evil/', name: 'Elsewhere' }),
	);
	await expect.poll(() => trayLabels(app)).not.toContain('Open Elsewhere');

	await app.close();
});

test('launch at login writes the autostart file, and takes it away again', async () => {
	const app = await launch(DEAD_URL);
	const win = await app.firstWindow();
	await expect(win.locator('#retry')).toBeVisible();

	// Nothing on install (ux.md's 95 % rule: nobody expects a cycling app in
	// their login items, so it is off until a rider asks).
	expect(fs.existsSync(app.autostartFile)).toBe(false);
	expect(await win.evaluate(() => window.wattroom.launchAtLogin())).toEqual({
		supported: true,
		enabled: false,
	});

	expect(
		await win.evaluate(() => window.wattroom.setLaunchAtLogin(true)),
	).toEqual({ supported: true, enabled: true, error: null });

	const entry = fs.readFileSync(app.autostartFile, 'utf8');
	expect(entry).toContain('[Desktop Entry]');
	expect(entry).toContain('Name=WattRoom');
	// The login launch opens no window: without the flag the rider gets the
	// app in their face at every boot, which is what makes people turn this
	// back off.
	expect(entry).toMatch(/^Exec=.* --hidden$/m);
	// An unpackaged run has to name the app directory too, or the login item
	// starts a bare Electron.
	expect(entry).toContain(__dirname);

	// And the tray's own switch is showing what Settings just did.
	expect(
		await app.evaluate(
			() =>
				process.mainModule
					.require('./tray')
					.menuTemplate()
					.find((i) => i.label === 'Launch at login').checked,
		),
	).toBe(true);

	// Reversible from inside the app, which is the whole bar for a setting
	// that reaches out of it.
	await clickTray(app, 'Launch at login', false);
	await expect.poll(() => fs.existsSync(app.autostartFile)).toBe(false);
	expect(await win.evaluate(() => window.wattroom.launchAtLogin())).toEqual({
		supported: true,
		enabled: false,
	});

	await app.close();
});

test('a login launch opens no window, and closing one later goes back to the tray', async () => {
	const app = await launch(DEAD_URL, null, ['--hidden']);
	let gone = false;
	app.on('close', () => (gone = true));
	// Nothing on screen: the shell is in the tray waiting to be asked.
	await new Promise((r) => setTimeout(r, 2000));
	expect(
		await app.evaluate(
			({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
		),
	).toBe(0);

	// The tray is the way in.
	await clickTray(app, 'Open WattRoom');
	const win = await app.firstWindow();
	await expect(win.locator('#retry')).toBeVisible();

	// Closing it must not quit: the rider asked WattRoom to be running when
	// they sign in, and quit is a menu item, not a window control. On Linux
	// and Windows, without the latch, this IS the quit.
	await app.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].close(),
	);
	// Waited out rather than polled: a poll passes on the first answer the
	// still-exiting process manages to give, which is how this test read green
	// against a shell that was on its way out.
	await new Promise((r) => setTimeout(r, 2000));
	expect(gone, 'the shell quit with its window').toBe(false);
	expect(
		await app.evaluate(
			({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
		),
	).toBe(0);
	expect(await trayLabels(app)).toContain('Open WattRoom');

	await app.close();
});
