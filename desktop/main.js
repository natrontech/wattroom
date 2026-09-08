// The WattRoom desktop shell (#296, ADR-0037).
//
// A window, a permission boundary, and the handlers Electron makes mandatory.
// It holds no product code: it loads the deployed web app, so the UI ships on
// every server deploy and a desktop release only happens when this file
// changes.
//
// Everything interesting here is in the four handlers (RESEARCH.md §15.1).
// Electron is not a browser with a title bar — each of these is something
// Chrome does for you, and each one's absence looks like a bug in WattRoom
// rather than a missing handler.

const {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	ipcMain,
	powerSaveBlocker,
	screen,
	shell,
} = require('electron');
const path = require('node:path');

// Where the shell points. The default is production; a dev build overrides it
// to a worktree's own Vite port (`make dev-env` prints it).
const APP_URL = process.env.WATTROOM_URL || 'https://wattroom.ch';
const APP_ORIGIN = new URL(APP_URL).origin;

// app.getVersion() returns ELECTRON's version when unpackaged, so it would
// report 44.x in dev and 0.1.0 in a build — and the update check compares this
// against the newest release tag. Read the manifest directly: main is not
// sandboxed, and this is the same number in both.
const SHELL_VERSION = require('./package.json').version;

// The OS title bar is hidden and the web app draws the strip (#1188): macOS
// drew a white bar over a dark app, and a bar the app owns follows its theme
// and its typography. This is its height; the preload hands it to the app
// as window.wattroom.titleBar, and the traffic lights and the Windows/Linux
// overlay controls are placed to sit inside it.
const TITLE_BAR_PX = 32;

// The last trainer a rider chose, so the chooser can skip itself next time.
// In memory only: a file would be state to migrate, and re-picking once per
// launch is the cost of not having one. ponytail: persist when riders complain.
let lastBluetoothDeviceId = null;

/** The only origin allowed to navigate, open windows, or hold a permission. */
function isOurs(url) {
	try {
		return new URL(url).origin === APP_ORIGIN;
	} catch {
		return false;
	}
}

function createWindow() {
	const win = new BrowserWindow({
		width: 1280,
		height: 860,
		minWidth: 380,
		backgroundColor: '#0a0118', // --color-surface, so the first paint is not white
		show: false,
		titleBarStyle: 'hidden',
		trafficLightPosition: { x: 14, y: (TITLE_BAR_PX - 12) / 2 },
		// Windows and Linux keep the native window controls, drawn over the
		// app's strip in the surface colour. ponytail: the colour is the dark
		// theme's; a light-theme rider there sees a dark control box until the
		// app tells the shell its scheme.
		titleBarOverlay: {
			color: '#0a0118',
			symbolColor: '#ffffff',
			height: TITLE_BAR_PX,
		},
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			// The preload is sandboxed and cannot read package.json, so the
			// version arrives as a switch it can parse off process.argv.
			additionalArguments: [
				`--wattroom-version=${SHELL_VERSION}`,
				`--wattroom-titlebar=${TITLE_BAR_PX}`,
			],
			// The three that matter with remote content. Defaults in modern
			// Electron, restated because a future edit that flips one of them
			// should have to delete a line that says why.
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			// Chromium throttles timers in a background window. workout/ticker.ts
			// already keeps the RIDE correct under throttling by reporting
			// wall-clock elapsed (#51) — this is for everything that has no such
			// defence: chart animation, the mixer's ramps, metrics polling.
			backgroundThrottling: false,
		},
	});

	win.once('ready-to-show', () => win.show());
	// The HUD shows only while this window is NOT in front (ADR-0041): in
	// front, the riding screen has the numbers, and floating them over the
	// jukebox's player would put a HUD over video, which YouTube's terms forbid.
	win.on('focus', () => hudWindow?.hide());
	win.on('blur', () => hudWindow?.showInactive());
	win.on('closed', () => setHud(false));
	installHandlers(win);
	load(win);
	return win;
}

/** errors.md: a page never renders blank on failure. */
function load(win) {
	win.loadURL(APP_URL).catch(() => {
		/* did-fail-load handles it; this only stops an unhandled rejection */
	});
}

function installHandlers(win) {
	const ses = win.webContents.session;

	// 1. Bluetooth. Electron ships no chooser at all: with no listener every
	//    request is CANCELLED (so requestDevice rejects), and with a listener
	//    that forgets preventDefault the FIRST device is selected silently —
	//    which in a room of advertising sensors is someone else's trainer.
	//    RESEARCH.md §15.1.
	win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
		event.preventDefault();

		if (devices.length === 0) {
			callback(''); // rejects in the renderer; media-error.ts has copy for it
			return;
		}
		const remembered = devices.find(
			(d) => d.deviceId === lastBluetoothDeviceId,
		);
		if (remembered) {
			callback(remembered.deviceId);
			return;
		}
		// The renderer's requestDevice filters already narrowed this list to
		// FTMS/HR/CSC, so everything offered here is pairable.
		chooseFrom(
			win,
			'Pair a sensor',
			devices.map((d) => ({
				label: d.deviceName || d.deviceId,
				value: d.deviceId,
			})),
		).then((deviceId) => {
			if (deviceId) lastBluetoothDeviceId = deviceId;
			callback(deviceId || '');
		});
	});

	// 2. Permissions. Electron's default is to ALLOW — with remote content that
	//    hands camera and microphone to anything that gets the renderer to
	//    navigate. Deny by default, allow our own origin the things a room
	//    actually needs.
	// 'notifications' too (#296): the app's own switch (lib/notify) asks for
	// it, and a shell that answered no left every room event silent — the one
	// thing a desktop app is expected to do better than a tab.
	const ALLOWED = new Set([
		'media',
		'clipboard-sanitized-write',
		'fullscreen',
		'notifications',
	]);
	ses.setPermissionRequestHandler((contents, permission, callback) => {
		callback(isOurs(contents.getURL()) && ALLOWED.has(permission));
	});
	// The check half: most web APIs check first and only request if denied, so
	// a handler on one and not the other is a gate with a hole in it.
	ses.setPermissionCheckHandler(
		(contents, permission, origin) =>
			(origin === APP_ORIGIN || isOurs(contents?.getURL() ?? '')) &&
			ALLOWED.has(permission),
	);

	// 3. Screen share. Electron does not implement standard getDisplayMedia, so
	//    without this the stage (#280) silently breaks. It must also survive
	//    cancellation — an unhandled rejection here leaves the renderer waiting
	//    forever (electron#47980).
	ses.setDisplayMediaRequestHandler(
		(request, callback) => {
			desktopCapturer
				.getSources({ types: ['screen', 'window'] })
				.then((sources) => {
					if (sources.length === 0) return callback({});
					return chooseFrom(
						win,
						'Share a screen',
						sources.map((s) => ({ label: s.name, value: s.id })),
					).then((id) => {
						const picked = sources.find((s) => s.id === id);
						// callback({}) is the deny path; a cancelled picker is a
						// refusal, not an error to surface.
						//
						// 'loopback' is the system-audio half of ADR-0037 (#1124):
						// what the machine is playing, captured through CoreAudio's
						// tap on macOS 14.2+ and WASAPI on Windows. Asked for
						// alongside the video rather than instead of it — the room
						// hears the machine that is showing it something.
						callback(picked ? { video: picked, audio: 'loopback' } : {});
					});
				})
				.catch(() => callback({}));
		},
		// The native picker on macOS, our message box everywhere else.
		//
		// Not a preference: with an app-supplied picker, macOS creates the
		// loopback track and never puts data in it (electron#52738) — live
		// readyState, no error, silence. The system picker is also what raises
		// the TCC "record system audio" prompt, so without it a rider is never
		// asked for the permission the capture needs.
		//
		// Electron ignores the flag below macOS 15, where the app picker is
		// still the only one, so this is safe to set for all of darwin.
		{ useSystemPicker: process.platform === 'darwin' },
	);

	guardNavigation(win);

	// The server-down screen. A shell whose remote never answers is a white
	// rectangle with no way out, which errors.md forbids.
	win.webContents.on(
		'did-fail-load',
		(event, code, description, url, isMain) => {
			if (!isMain || code === -3) return; // -3 is an aborted load, not a failure
			void win.webContents.loadFile(path.join(__dirname, 'offline.html'), {
				query: { url: APP_URL, reason: description || String(code) },
			});
		},
	);
}

/**
 * 4. Navigation. Remote content that can navigate a window anywhere is the
 * same hole as the permission default, one step removed. Every window the
 * shell opens gets this — the main one and the HUD.
 */
function guardNavigation(win) {
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:/.test(url)) void shell.openExternal(url);
		return { action: 'deny' };
	});
	win.webContents.on('will-navigate', (event, url) => {
		if (isOurs(url)) return;
		event.preventDefault();
		if (/^https?:/.test(url)) void shell.openExternal(url);
	});
}

/**
 * A chooser with no UI of its own. `dialog.showMessageBox` is native, needs no
 * renderer, and cannot drift from the app's theme because it has none.
 *
 * ponytail: caps at eight entries plus Cancel — past that a message box is the
 * wrong control, and the answer is the renderer-side picker RESEARCH.md §15.1
 * describes, not a longer list of buttons.
 */
async function chooseFrom(win, title, options) {
	const shown = options.slice(0, 8);
	const { response } = await dialog.showMessageBox(win, {
		type: 'question',
		title,
		message: title,
		buttons: [...shown.map((o) => o.label), 'Cancel'],
		cancelId: shown.length,
		defaultId: 0,
	});
	return shown[response]?.value ?? null;
}

// The HUD (#296, ADR-0041): the rider's own numbers in a small frameless
// window that floats over everything else — for the rider who alt-tabbed to
// a film mid-interval. The web app opens it when a ride starts and closes it
// when the ride ends; it loads /hud on our origin, in the same session, and
// that page mirrors the riding screen through a BroadcastChannel. This
// process only decides WHEN it is visible: never while the main window is in
// front (see createWindow). The page's own close button sends hud(false),
// and it stays closed until the next ride starts.
const HUD_SIZE = { width: 320, height: 132 };
let hudWindow = null;

function setHud(on) {
	if (!on) {
		if (hudWindow && !hudWindow.isDestroyed()) hudWindow.close();
		hudWindow = null;
		return;
	}
	if (hudWindow) return;
	const main = BrowserWindow.getAllWindows()[0];
	if (!main) return;
	hudWindow = new BrowserWindow({
		...HUD_SIZE,
		frame: false,
		alwaysOnTop: true,
		resizable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		backgroundColor: '#0a0118',
		show: false,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			additionalArguments: [`--wattroom-version=${SHELL_VERSION}`],
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			backgroundThrottling: false,
		},
	});
	// Above full-screen apps too, and on every desktop — that is the point.
	hudWindow.setAlwaysOnTop(true, 'floating');
	hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	// Top-right of the display the app is on, a finger's width in.
	const { workArea } = screen.getDisplayMatching(main.getBounds());
	hudWindow.setPosition(
		workArea.x + workArea.width - HUD_SIZE.width - 16,
		workArea.y + 16,
	);
	guardNavigation(hudWindow);
	hudWindow.on('closed', () => {
		hudWindow = null;
	});
	hudWindow.once('ready-to-show', () => {
		if (hudWindow && !main.isFocused()) hudWindow.showInactive();
	});
	hudWindow.loadURL(`${APP_ORIGIN}/hud`).catch(() => {
		/* a HUD that cannot load is closed by the next hud(false) */
	});
}

ipcMain.on('wattroom:hud', (_event, on) => setHud(Boolean(on)));

// wattroom:// — the way back into the app from the system browser (#1188).
//
// Sign-in happens in the browser, because it cannot happen here: Electron has
// no WebAuthn UI, so a passkey request never resolves, and Google refuses
// OAuth from an Electron window outright. The web app opens
// /login?desktop=<nonce> in the browser, the rider signs in there however
// they like, and the page comes back through wattroom://auth/<token>. All
// the shell does with it is load /login?handoff=<token> on its own origin;
// the page redeems the token with the nonce it kept, and the server mints
// this window its own session. Nothing else is accepted: an unknown path or
// an odd-looking token is dropped, not loaded.
const DEEP_LINK_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

function deepLinkTarget(link) {
	let url;
	try {
		url = new URL(link);
	} catch {
		return null;
	}
	if (url.protocol !== 'wattroom:' || url.hostname !== 'auth') return null;
	const token = url.pathname.replace(/^\//, '');
	if (!DEEP_LINK_TOKEN.test(token)) return null;
	// APP_ORIGIN, not APP_URL: a WATTROOM_URL with a trailing slash made this
	// `//login`, which the smoke caught.
	return `${APP_ORIGIN}/login?handoff=${encodeURIComponent(token)}`;
}

// macOS delivers the link before the window exists when the app was not
// running; hold it until ready-to-show.
let pendingDeepLink = null;

function openDeepLink(link) {
	const target = deepLinkTarget(link);
	if (!target) return;
	const [win] = BrowserWindow.getAllWindows();
	if (!win) {
		pendingDeepLink = target;
		return;
	}
	if (win.isMinimized()) win.restore();
	win.focus();
	win.loadURL(target).catch(() => {
		/* did-fail-load shows the offline screen */
	});
}

const deepLinkIn = (argv) => argv.find((a) => a.startsWith('wattroom://'));

// Windows shows a notification only for an app with a model id; without
// this every new Notification() from the renderer is dropped on the floor.
if (process.platform === 'win32') app.setAppUserModelId('ch.wattroom.desktop');

app.setAsDefaultProtocolClient('wattroom');
app.on('open-url', (event, link) => {
	event.preventDefault();
	openDeepLink(link);
});

// One instance. Without this every wattroom:// link opens a second window
// against the same session; on Windows and Linux the link arrives as the
// second instance's argv.
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', (_event, argv) => {
		const link = deepLinkIn(argv);
		if (link) {
			openDeepLink(link);
			return;
		}
		const [win] = BrowserWindow.getAllWindows();
		if (!win) return;
		if (win.isMinimized()) win.restore();
		win.focus();
	});

	app.whenReady().then(() => {
		const win = createWindow();
		// A cold start from a link, on Windows and Linux.
		const link = deepLinkIn(process.argv);
		if (link) pendingDeepLink = deepLinkTarget(link);
		if (pendingDeepLink) {
			const target = pendingDeepLink;
			pendingDeepLink = null;
			win.once('ready-to-show', () => void win.loadURL(target).catch(() => {}));
		}
		app.on('activate', () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});

	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') app.quit();
	});
}

// Keep the machine awake while a ride runs (#296). The browser's wake lock
// holds the SCREEN and is dropped whenever the document hides; this holds the
// system, which is the half a tab cannot reach. Started and stopped by
// workout/wakelock.ts, so a ride is the only thing that can hold it.
let sleepBlockerId = null;

function keepAwake(on) {
	if (on) {
		if (sleepBlockerId === null) {
			sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');
		}
		return;
	}
	if (sleepBlockerId !== null) {
		powerSaveBlocker.stop(sleepBlockerId);
		sleepBlockerId = null;
	}
}

ipcMain.on('wattroom:keep-awake', (_event, on) => keepAwake(Boolean(on)));

// A renderer that crashes or navigates mid-ride would otherwise leave the
// machine awake until quit.
app.on('browser-window-created', (_e, win) => {
	win.webContents.on('render-process-gone', () => keepAwake(false));
	win.on('closed', () => keepAwake(false));
});
app.on('will-quit', () => keepAwake(false));

// Retry from the offline screen, and the only channel the preload exposes.
ipcMain.on('wattroom:retry', (event) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (win) load(win);
});
