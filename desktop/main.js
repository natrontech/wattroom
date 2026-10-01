// The WattRoom desktop shell (#296, ADR-0037).
//
// A window, a permission boundary, and the handlers Electron makes mandatory.
// It holds no product code: it loads the deployed web app, so the UI ships on
// every server deploy and a desktop release only happens when the shell
// changes. What would crowd this file lives beside it: the window's state,
// notifications, the HUD, deep links, the updater, the Bluetooth chooser and
// the permission handlers each have a module.
//
// Everything interesting is in the four handlers (RESEARCH.md §15.1):
// Bluetooth (bluetooth.js), permissions and screen share (permissions.js),
// and navigation (guardNavigation, below). Electron is not a browser with a
// title bar — each of these is something Chrome does for you, and each one's
// absence looks like a bug in WattRoom rather than a missing handler.

const {
	app,
	BrowserWindow,
	ipcMain,
	Menu,
	MenuItem,
	powerSaveBlocker,
	shell,
} = require('electron');
const path = require('node:path');
const badge = require('./badge');
const bluetooth = require('./bluetooth');
const deepLink = require('./deep-link');
const hud = require('./hud');
const log = require('./log');
const loginItem = require('./login-item');
const notifications = require('./notifications');
const permissions = require('./permissions');
const tray = require('./tray');
const updater = require('./updater');
const visibility = require('./visibility');
const windowState = require('./window-state');

// Where the shell points. The default is production; a dev build overrides it
// to a worktree's own Vite port (`make dev-env` prints it).
const APP_URL = process.env.WATTROOM_URL || 'https://wattroom.ch';
const APP_ORIGIN = new URL(APP_URL).origin;

// app.getVersion() returns ELECTRON's version when unpackaged, so it would
// report 44.x in dev and 0.1.0 in a build — and the update check compares this
// against the newest release tag. Read the manifest directly: main is not
// sandboxed, and this is the same number in both.
const SHELL_VERSION = require('./package.json').version;

// Before anything can warn: stdout goes nowhere in a packaged app (#3012).
const LOG_FILE = log.teeConsole(path.join(app.getPath('logs'), 'main.log'));
log.append(
	LOG_FILE,
	`${new Date().toISOString()} start ${SHELL_VERSION}${app.isPackaged ? '' : ' (unpackaged)'} ${process.platform}\n`,
);

// The OS title bar is hidden and the web app draws the strip (#1188): macOS
// drew a white bar over a dark app, and a bar the app owns follows its theme
// and its typography. This is its height; the preload hands it to the app
// as window.wattroom.titleBar, and the traffic lights and the Windows/Linux
// overlay controls are placed to sit inside it.
const TITLE_BAR_PX = 32;

/** The shell's own offline screen, the one page not on APP_ORIGIN that speaks to it. */
const OFFLINE_URL = require('node:url').pathToFileURL(
	path.join(__dirname, 'offline.html'),
).href;

/**
 * Whether an IPC message came from our own page (#3010, Electron's security
 * checklist, item 17): the app on APP_ORIGIN, or the offline screen. The
 * preload runs only in the main frame and the navigation guard keeps that
 * frame on our origin, so this is the second line — the one that still holds
 * the day either of those changes. A frame that is gone has no URL, and is
 * refused.
 */
function fromUs(event) {
	const url = event?.senderFrame?.url;
	if (typeof url !== 'string') return false;
	return isOurs(url) || url.split(/[?#]/)[0] === OFFLINE_URL;
}

/**
 * `ipcMain.on` and `.handle`, answering only `fromUs`. Every handler goes
 * through here so a new one cannot forget the check; smoke.spec.js refuses a
 * bare `ipcMain.on(` or `.handle(` anywhere else in this file.
 */
const ipc = {
	on: (channel, fn) =>
		ipcMain.on(channel, (event, ...args) => {
			if (fromUs(event)) fn(event, ...args);
		}),
	handle: (channel, fn) =>
		ipcMain.handle(channel, (event, ...args) =>
			fromUs(event) ? fn(event, ...args) : undefined,
		),
};

/** The only origin allowed to navigate, open windows, or hold a permission. */
function isOurs(url) {
	try {
		return new URL(url).origin === APP_ORIGIN;
	} catch {
		return false;
	}
}

/**
 * Whether the login item started this run (#1313, login-item.js): the window
 * is then created loaded but hidden (#3005), so notifications, the lobby
 * socket and deep links work from boot without putting a window in front of
 * the rider.
 */
let startedHidden = false;

/**
 * Whether there is a tray to hide into (#3005). Where there is, closing the
 * main window hides it (visibility.js); a Linux desktop with no status
 * notifier keeps the close that quits.
 */
let hasTray = false;

/**
 * The rider's window, never the HUD.
 *
 * `getAllWindows()` has no order, so `[0]` was the HUD as often as not once
 * one was open — which would have pointed a wattroom:// hand-off, a second
 * instance and now the tray at a 320×132 frameless panel.
 */
function mainWindow() {
	return (
		BrowserWindow.getAllWindows().find(
			(w) => !w.isDestroyed() && w !== hud.current(),
		) ?? null
	);
}

/** Bring a window to the rider: un-minimised, on screen, in front. */
function focusWindow(win) {
	if (!win || win.isDestroyed()) return;
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
	visibility.shown(win);
}

/**
 * The tray's "Open WattRoom", the Dock, a second launch: show the rider's
 * window, hidden or not, or make one if there is none.
 */
function openWindow() {
	const win = mainWindow();
	if (win) focusWindow(win);
	else createWindow();
}

/**
 * The tray's "Open <room>". Sent to the page rather than loaded: a
 * navigation would reload the SPA, which mid-ride means dropping the socket
 * and the trainer. A shell with no window opens on the app's home instead —
 * nothing reported a room, because nothing was running to report one.
 */
function openPath(to) {
	const win = mainWindow();
	if (!win) {
		createWindow();
		return;
	}
	focusWindow(win);
	win.webContents.send('wattroom:go', to);
}

/** @param opts.hidden load it without showing it (a login launch, #3005) */
function createWindow({ hidden = false } = {}) {
	const saved = windowState.read();
	const win = new BrowserWindow({
		...windowState.bounds(saved),
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

	// Maximizing shows a window, so a hidden launch waits for the first show.
	win.once(hidden ? 'show' : 'ready-to-show', () => {
		if (saved?.fullScreen) win.setFullScreen(true);
		else if (saved?.maximized) win.maximize();
		if (!hidden) win.show();
	});
	visibility.manage(win, {
		hides: hasTray,
		hidden,
		rideHeld: () => sleepBlockerId !== null,
	});
	windowState.track(win);
	// The HUD shows only while this window is NOT in front (ADR-0041): in
	// front, the riding screen has the numbers, and floating them over the
	// jukebox's player would put a HUD over video, which YouTube's terms forbid.
	win.on('focus', () => hud.current()?.hide());
	win.on('blur', () => hud.current()?.showInactive());
	win.on('closed', () => {
		hud.set(false);
		// Nothing is connected to a room any more, so the tray must stop
		// offering to open one (it would open a window on the app's home and
		// look like the item did nothing).
		tray.setRoom(null);
	});
	installHandlers(win);
	load(win);
	// Once: the adapter stays up for the life of the process.
	win.webContents.once('did-finish-load', () => bluetooth.warm(win));
	return win;
}

/** errors.md: a page never renders blank on failure. */
function load(win) {
	win.loadURL(APP_URL).catch(() => {
		/* did-fail-load handles it; this only stops an unhandled rejection */
	});
}

function installHandlers(win) {
	bluetooth.attach(win);
	permissions.attach(win);
	guardNavigation(win);
	textMenu(win);

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
 * The menu a text field gets in every browser (#3006). Electron draws no
 * context menu at all, so a right-click in the chat box offered no paste and
 * no fix for the word the spellchecker underlined. The app's own menus — a
 * message, a tile — cancel the DOM event, and Electron raises this one only
 * when nothing did, so they stay the app's.
 */
function textMenu(win) {
	win.webContents.on('context-menu', (_event, p) => {
		if (!p.isEditable && !p.selectionText) return;
		const spelling = [
			...p.dictionarySuggestions.map((word) => ({
				label: word,
				click: () => win.webContents.replaceMisspelling(word),
			})),
			...(p.misspelledWord
				? [
						{
							label: 'Add to Dictionary',
							click: () =>
								win.webContents.session.addWordToSpellCheckerDictionary(
									p.misspelledWord,
								),
						},
						{ type: 'separator' },
					]
				: []),
		];
		const editing = p.isEditable
			? [
					{ role: 'cut', enabled: p.editFlags.canCut },
					{ role: 'copy', enabled: p.editFlags.canCopy },
					{ role: 'paste', enabled: p.editFlags.canPaste },
					{ role: 'selectAll' },
				]
			: [{ role: 'copy' }];
		Menu.buildFromTemplate([...spelling, ...editing]).popup({ window: win });
	});
}

/**
 * 4. Navigation. Remote content that can navigate a window anywhere is the
 * same hole as the permission default, one step removed. Every window the
 * shell opens gets this — the main one and the HUD.
 */
function guardNavigation(win) {
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith(`${APP_ORIGIN}/login?desktop=`))
			deepLink.signInStarted();
		if (/^https?:/.test(url)) void shell.openExternal(url);
		return { action: 'deny' };
	});
	win.webContents.on('will-navigate', (event, url) => {
		if (isOurs(url)) return;
		event.preventDefault();
		if (/^https?:/.test(url)) void shell.openExternal(url);
	});
	// A navigation to our origin that the server redirects elsewhere never
	// reaches will-navigate with the foreign URL (#2826): /api/auth/{id}/start
	// answers 302 to the provider. The main frame only — the jukebox's
	// YouTube frame redirects within Google's own hosts.
	win.webContents.on('will-redirect', (event) => {
		if (!event.isMainFrame || isOurs(event.url)) return;
		event.preventDefault();
		if (/^https?:/.test(event.url)) void shell.openExternal(event.url);
	});
}

bluetooth.install({ ipc });
permissions.install({ appOrigin: APP_ORIGIN, isOurs });
updater.install({ ipc });
hud.install({
	ipc,
	appOrigin: APP_ORIGIN,
	version: SHELL_VERSION,
	mainWindow,
	guardNavigation,
});
notifications.install({ ipc, focus: focusWindow });
const { clip, ownPath } = notifications;

// The tray's "Open <room>" (#1313). The app says which room it is connected
// to, and the shell only ever puts the name in a menu item and sends the
// path back. Clipped and checked like a notification's, and for the same
// reason: remote content chooses the words, never where the app goes.
ipc.on('wattroom:room', (event, r) => {
	// The HUD runs the app's layout too (#1938), and it speaks for no room.
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win || win.isDestroyed() || win === hud.current()) return;
	const to = r && typeof r === 'object' ? ownPath(r.path) : '';
	tray.setRoom(to ? { path: to, name: clip(r.name, 60) || to } : null);
});

// The unread badge (#3008): the main window's sidebar speaks for it, never
// the HUD, which runs the app's layout too (#1938). The count is clamped in
// badge.js before the OS sees it.
ipc.on('wattroom:badge', (event, n) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win || win.isDestroyed() || win === hud.current()) return;
	badge.set(n, win);
});

// Launch at login (#1313). The shell owns the OS side; Settings and the tray
// are the two places that ask for it, and both get the same answer — whether
// this build can do it at all, whether it is on, and one sentence when a
// change did not take.
ipc.handle('wattroom:login-item', () => loginItem.state());
ipc.handle('wattroom:login-item-set', (_event, on) => {
	const error = loginItem.setEnabled(on === true);
	// The tray carries the same switch, and a tick it did not draw itself is
	// still its tick.
	tray.refresh();
	return { ...loginItem.state(), error };
});

// Windows shows a notification only for an app with a model id; without
// this every new Notification() from the renderer is dropped on the floor.
if (process.platform === 'win32') app.setAppUserModelId('ch.wattroom.desktop');

deepLink.install({ mainWindow, focus: focusWindow });

// One instance. Without this every wattroom:// link opens a second window
// against the same session; on Windows and Linux the link arrives as the
// second instance's argv.
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', (_event, argv) => {
		const link = deepLink.inArgv(argv);
		if (link) {
			deepLink.open(link);
			return;
		}
		// Launching the installed app again shows the window, hidden or not —
		// without this, clicking it while the shell sat in the tray did
		// nothing at all.
		openWindow();
	});

	app.whenReady().then(() => {
		// An explicit menu (#1943): Electron's default one shipped Help and
		// all. The roles are the shortcuts: in Electron a window's keyboard
		// shortcuts ARE its menu's accelerators, so Windows and Linux, which
		// had none, had no zoom for a rider three metres away and no Ctrl+R
		// (#3007). There the window is frameless, which draws no menu bar and
		// still registers every accelerator — the app's own strip stays the top
		// of the window. On macOS Close is in the File menu, not the Window
		// one: without fileMenu, ⌘W did nothing (#3001).
		const menu = Menu.buildFromTemplate([
			...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
			{ role: 'fileMenu' },
			{ role: 'editMenu' },
			{ role: 'viewMenu' },
			{ role: 'windowMenu' },
		]);
		// Ctrl+= zooms in every browser. The role's own accelerator is
		// Ctrl+Plus, which Windows and Linux read as Ctrl+Shift+=, so the key
		// a rider actually presses did nothing without this.
		menu.items
			.find((m) => m.role === 'viewmenu')
			.submenu.append(
				new MenuItem({
					role: 'zoomIn',
					accelerator: 'CommandOrControl+=',
					visible: false,
				}),
			);
		Menu.setApplicationMenu(menu);
		// Launched by the login item, the shell loads its window hidden: it
		// comes up in the tray, running, and waits to be asked (login-item.js,
		// #3005). Every other launch shows the window.
		startedHidden = loginItem.startedByLoginItem();
		// Before any window: whether a close may hide it depends on there
		// being a tray to hide into. Where there is nowhere to put one — a
		// Linux desktop with no status notifier — a hidden launch would be a
		// process with no surface at all, so it shows the window instead, and
		// a close there quits as it always did.
		hasTray = tray.install({ open: openWindow, go: openPath });
		if (!hasTray) startedHidden = false;
		createWindow({ hidden: startedHidden });
		updater.watch();
		// A cold start from a link is dropped (#1941): no sign-in was started
		// from this run, and the rider starts the sign-in again.
		if (deepLink.inArgv(process.argv))
			console.warn('wattroom:// link at launch ignored');
		// A Dock click brings the rider's window back, not merely a window
		// (#2660): with the HUD up macOS counts a visible window and restores
		// nothing, so a minimised main window stayed in the Dock mid-ride.
		app.on('activate', openWindow);
	});

	app.on('window-all-closed', () => {
		// With a tray a close hides the window (#3005), so this is reached
		// only on the way out. Without one, closing the window quits,
		// everywhere but macOS.
		if (process.platform !== 'darwin' && !hasTray) app.quit();
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
	} else if (sleepBlockerId !== null) {
		powerSaveBlocker.stop(sleepBlockerId);
		sleepBlockerId = null;
	}
	// A ride in a hidden window keeps its timers at full rate; the hidden
	// window with no ride gets throttled again (#3005).
	const win = mainWindow();
	if (win) visibility.throttleIfIdle(win, () => sleepBlockerId !== null);
}

ipc.on('wattroom:keep-awake', (_event, on) => keepAwake(Boolean(on)));

// A renderer that crashes or navigates mid-ride would otherwise leave the
// machine awake until quit.
app.on('browser-window-created', (_e, win) => {
	win.webContents.on('render-process-gone', (_event, details) => {
		keepAwake(false);
		// A crash left the white rectangle errors.md forbids (#1942): the
		// offline screen has the retry, so it gets the crash too.
		if (details?.reason === 'clean-exit' || win.isDestroyed()) return;
		console.warn('renderer gone:', details?.reason);
		void win.webContents.loadFile(path.join(__dirname, 'offline.html'), {
			query: {
				url: APP_URL,
				reason: `the app stopped (${details?.reason ?? 'crash'})`,
			},
		});
	});
	win.on('closed', () => keepAwake(false));
});
app.on('will-quit', () => keepAwake(false));

// Retry from the offline screen, and the only channel the preload exposes.
ipc.on('wattroom:retry', (event) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (win) load(win);
});
