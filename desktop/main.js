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
	Menu,
	Notification,
	powerSaveBlocker,
	screen,
	shell,
} = require('electron');
const fs = require('node:fs');
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

// How long a scan may find NOTHING before the rider gets an answer. A trainer
// woken by the cranks is advertising within a couple of seconds; past this it
// is asleep, and saying so beats a button that never comes back. It stops
// counting the moment the first device is heard: from there the picker is on
// screen and the decision is the rider's, not a deadline's.
const PAIRING_TIMEOUT_MS = 20_000;

// Whether the loaded web app draws the device picker (#1716). The shell and
// the app release on separate trains, so a shell newer than wattroom.ch is an
// ordinary state — registering the listener is the handshake, and without it
// the native message box below is still the answer.
let pickerReady = false;
// Registering the listener is the app saying it can draw the picker.
ipcMain.on('wattroom:ble-picker-ready', () => {
	pickerReady = true;
});

/**
 * The Bluetooth request currently open, if any.
 *
 * Chromium runs one chooser at a time and cancels the old one when a new
 * request starts, so a single slot is the whole state machine. Module scope
 * rather than per-window, like every other ipcMain handler here: the rider's
 * answer arrives on a channel, not through a window.
 */
let scan = null;

/** Answer the chooser once, whichever emit's callback is current. */
function settleScan(deviceId) {
	if (!scan) return;
	clearTimeout(scan.timer);
	const { answer, contents } = scan;
	scan = null;
	if (!contents.isDestroyed()) contents.send('wattroom:ble-scan', null);
	answer(deviceId);
}

// The rider picked, or closed the picker. Ignored when no request is open:
// a stale answer must never settle the NEXT one.
ipcMain.on('wattroom:ble-pick', (_event, deviceId) =>
	settleScan(deviceId || ''),
);

// True only for the launch warm-up (warmBluetooth), so its chooser is answered
// rather than shown.
let warmingBluetooth = false;

/**
 * Spend the first Bluetooth failure at launch, where nobody is waiting (#1545).
 *
 * Chromium creates the CoreBluetooth manager on the FIRST requestDevice and
 * reports the adapter powered-off until it answers, ~300 ms later. Chrome's own
 * chooser draws "turn Bluetooth on" and recovers when it does; Electron turns
 * the same signal into a cancelled chooser, and `select-bluetooth-device` never
 * fires — so nothing in this file can see that request, let alone retry it. The
 * rider's first pairing attempt of every launch failed with "User cancelled",
 * having asked them nothing.
 *
 * `true` is the user-gesture argument: requestDevice needs transient activation.
 *
 * Packaged builds only. TCC does not accept the prebuilt Electron's Info.plist,
 * so an unpackaged shell is SIGABRTed the moment anything touches CoreBluetooth
 * — a dev shell cannot pair a trainer on macOS at all, and warming one at
 * launch would kill `pnpm start` on the spot.
 */
function warmBluetooth(win) {
	if (!app.isPackaged) return;
	warmingBluetooth = true;
	win.webContents
		.executeJavaScript(
			`navigator.bluetooth?.requestDevice({ filters: [{ services: ['fitness_machine'] }] }).catch(() => {})`,
			true,
		)
		.catch(() => {
			/* no Web Bluetooth (the offline screen is a file:// page) */
		})
		.finally(() => {
			warmingBluetooth = false;
		});
}

/** The only origin allowed to navigate, open windows, or hold a permission. */
function isOurs(url) {
	try {
		return new URL(url).origin === APP_ORIGIN;
	} catch {
		return false;
	}
}

// Where the window was (#1948): size, position and whether it was maximized,
// kept in userData and restored only when the saved rect still lands on a
// display that is here — a monitor that went with the rider's desk keeps
// the size and drops the position. The HUD places itself (ADR-0041).
function windowStateFile() {
	return path.join(app.getPath('userData'), 'window.json');
}
function readWindowState() {
	try {
		const s = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
		if (typeof s.width === 'number' && typeof s.height === 'number') return s;
	} catch {
		/* first launch, or a file nobody wrote */
	}
	return null;
}
function onADisplay(b) {
	return screen.getAllDisplays().some(({ workArea: a }) => {
		return (
			b.x < a.x + a.width &&
			b.x + b.width > a.x &&
			b.y < a.y + a.height &&
			b.y + b.height > a.y
		);
	});
}
function saveWindowState(win) {
	try {
		const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
		fs.writeFileSync(
			windowStateFile(),
			JSON.stringify({ ...bounds, maximized: win.isMaximized() }),
		);
	} catch (err) {
		console.warn('window state not saved:', err?.message ?? err);
	}
}

function createWindow() {
	const saved = readWindowState();
	const placed =
		saved &&
		typeof saved.x === 'number' &&
		typeof saved.y === 'number' &&
		onADisplay(saved)
			? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
			: { width: saved?.width ?? 1280, height: saved?.height ?? 860 };
	const win = new BrowserWindow({
		...placed,
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

	win.once('ready-to-show', () => {
		if (saved?.maximized) win.maximize();
		win.show();
	});
	win.on('close', () => saveWindowState(win));
	// The HUD shows only while this window is NOT in front (ADR-0041): in
	// front, the riding screen has the numbers, and floating them over the
	// jukebox's player would put a HUD over video, which YouTube's terms forbid.
	win.on('focus', () => hudWindow?.hide());
	win.on('blur', () => hudWindow?.showInactive());
	win.on('closed', () => setHud(false));
	installHandlers(win);
	load(win);
	// Once: the adapter stays up for the life of the process.
	win.webContents.once('did-finish-load', () => warmBluetooth(win));
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
	//
	//    Electron emits this the moment the scan starts — ~130 ms in, before
	//    anything can have advertised — and again for every device it hears.
	//    Answering that first empty list is a cancel, which is how the shell
	//    shipped unable to pair anything at all (#1545): hold the callback and
	//    let the scan run.
	//
	//    What the rider sees is the app's own modal, fed the list as the scan
	//    grows it (#1716). It used to be `dialog.showMessageBox` with one
	//    button per device — an OS alert in the middle of a synthwave app, and
	//    a SNAPSHOT: it opened on the first device heard, so a second sensor
	//    advertising a moment later was invisible until you cancelled and
	//    started again. RESEARCH.md §15.1 named the renderer-side picker as
	//    the upside of owning this event; this is it.
	//
	//    Nothing is remembered between scans any more. The shell used to skip
	//    the picker entirely for the last device it had seen — process-wide,
	//    across every sensor kind — which saved a tap once and then made
	//    pairing a DIFFERENT trainer impossible for the rest of the launch.
	//    §15.1 lists remembering as an upside of owning the chooser; it is
	//    one only if the rider can still get past it.
	//
	//    The slot and its answer channel are at module scope above; only the
	//    event itself belongs to this window.
	win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
		event.preventDefault();

		// The launch warm-up below is a request nobody asked for: never put a
		// picker in front of a rider for it.
		if (warmingBluetooth) {
			callback('');
			return;
		}

		// Every emit brings a fresh callback into the same chooser; the newest
		// is the one to answer with. A request that supersedes another
		// inherits its countdown, which is only ever short — and the picker is
		// modal, so the rider cannot start a second search while one is open.
		if (!scan) {
			scan = {
				// Nothing found in this long means the sensor is asleep, not that
				// the rider is still deciding. Cancelling gives the renderer a
				// rejection it has copy for; silence would hang the pair button.
				timer: setTimeout(() => settleScan(''), PAIRING_TIMEOUT_MS),
			};
		}
		scan.answer = callback;
		scan.contents = win.webContents;

		// The renderer's requestDevice filters already narrowed this list to
		// FTMS/HR/CSC, so everything offered here is pairable.
		const offer = devices.map((d) => ({
			id: d.deviceId,
			name: d.deviceName || d.deviceId,
		}));

		if (pickerReady) {
			// Something is advertising, so the deadline is over — the rider is
			// now reading a list, and a countdown would close it under them.
			if (offer.length > 0) clearTimeout(scan.timer);
			win.webContents.send('wattroom:ble-scan', offer);
			return;
		}

		// A web app too old to draw the picker (see pickerReady). The message
		// box is a snapshot: a sensor heard after it opens is not in it.
		if (offer.length === 0 || scan.asked) return;
		scan.asked = true;
		chooseFrom(
			win,
			'Pair a sensor',
			offer.map((d) => ({ label: d.name, value: d.id })),
		).then(({ value: deviceId }) => settleScan(deviceId || ''));
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
	// Decided on the FRAME that asks (#1939), not the top page: the embedded
	// player is a third-party frame under our page, and the top URL let it
	// inherit the mic, notifications and fullscreen.
	ses.setPermissionRequestHandler((contents, permission, callback, details) => {
		const from = details?.requestingUrl ?? contents.getURL();
		callback(isOurs(from) && ALLOWED.has(permission));
	});
	// The check half: most web APIs check first and only request if denied, so
	// a handler on one and not the other is a gate with a hole in it.
	ses.setPermissionCheckHandler(
		(_contents, permission, origin) =>
			origin === APP_ORIGIN && ALLOWED.has(permission),
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
						canShareSound() && request.audioRequested ? SOUND_ASK : null,
					).then(({ value: id, checked: sound }) => {
						const picked = sources.find((s) => s.id === id);
						// callback({}) is the deny path; a cancelled picker is a
						// refusal, not an error to surface.
						//
						// 'loopback' is the system-audio half of ADR-0037 (#1124):
						// what the machine is playing, captured through WASAPI.
						// Offered with the picture and never assumed (#1699): the
						// tap is the whole machine, so a rider who picked one
						// window would otherwise also send their notifications,
						// their calls and the room's own voices back into it.
						if (!picked) return callback({});
						callback(
							sound ? { video: picked, audio: 'loopback' } : { video: picked },
						);
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
// When the app last sent the rider to the system browser to sign in
// (#1941): a wattroom:// link is accepted only for a little while after,
// so a page in the rider's browser cannot throw a riding shell onto /login.
let signInStartedAt = 0;
const SIGN_IN_WINDOW_MS = 10 * 60 * 1000;

function guardNavigation(win) {
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith(`${APP_ORIGIN}/login?desktop=`))
			signInStartedAt = Date.now();
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
 * Whether the machine's sound can ride along with the picture (#1124, #1699).
 *
 * Windows only, and not a preference: this handler runs on macOS only below
 * 15, where an app-supplied picker gets a loopback track with no data in it
 * (electron#52738) — asking there would promise a sound that never arrives
 * and leave the share notice claiming one. Above 15 the system picker asks
 * for audio itself, and Linux Chromium has no loopback at all.
 */
function canShareSound() {
	return process.platform === 'win32';
}

/**
 * What the loopback tap actually takes, said plainly: it is the machine's
 * output device, not the window the rider picked — Chromium has no per-app
 * tap to offer instead. Off unless ticked: the rider chose a window, and the
 * machine is more than they chose.
 */
const SOUND_ASK =
	"Send this machine's sound too — everything it plays, not just what you pick";

/**
 * A chooser with no UI of its own. `dialog.showMessageBox` is native, needs no
 * renderer, and cannot drift from the app's theme because it has none.
 *
 * ponytail: caps at eight entries plus Cancel — past that a message box is the
 * wrong control. The Bluetooth chooser outgrew it and now draws in the app
 * (#1716); the screen picker still fits, and its checkbox has no counterpart
 * in a renderer-side one.
 *
 * @returns the chosen value (null if cancelled), and the checkbox if asked.
 */
async function chooseFrom(win, title, options, checkboxLabel = null) {
	const shown = options.slice(0, 8);
	const { response, checkboxChecked } = await dialog.showMessageBox(win, {
		type: 'question',
		title,
		message: title,
		buttons: [...shown.map((o) => o.label), 'Cancel'],
		cancelId: shown.length,
		defaultId: 0,
		...(checkboxLabel ? { checkboxLabel, checkboxChecked: false } : {}),
	});
	return {
		value: shown[response]?.value ?? null,
		checked: checkboxChecked === true,
	};
}

// Self-update (#1303, ADR-0037 amended). Four shell releases in a day made
// the nudge the wrong answer: the shell now asks the releases repo on launch
// and every few hours, downloads the next release in the background, and
// installs it when the rider restarts — or quietly on quit. The feed is
// GitHub's `releases/latest/download` alias (package.json → publish), which
// is what lets the tags stay desktop-v<CalVer> instead of v<semver>. The web
// app is told when a download is ready and offers "Restart to update" at the
// top of the sidebar, which a ride never shows — so never mid-ride, by
// construction.
let updateReady = null;
let autoUpdater = null;

function watchForUpdates() {
	// Required here, not at the top: merely touching electron-updater's
	// autoUpdater constructs it, and it parses the app's version as semver —
	// a dev run reports Electron's own version, a packaged app reports
	// package.json's, and a malformed one crashes at launch with a dialog.
	if (!app.isPackaged) return;
	({ autoUpdater } = require('electron-updater'));
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	// stdout: nothing in a Dock launch, everything when run from a terminal —
	// which is how "why did it not update" gets answered in a minute.
	autoUpdater.logger = console;
	autoUpdater.on('update-available', () => (updateFailures = 0));
	autoUpdater.on('update-not-available', () => (updateFailures = 0));
	autoUpdater.on('update-downloaded', (info) => {
		updateFailures = 0;
		updateReady = { version: info.version };
		// Every window, not the one at launch (#1947): on macOS a window
		// closed and reopened from the Dock is a new one.
		for (const w of BrowserWindow.getAllWindows())
			if (!w.isDestroyed()) w.webContents.send('wattroom:update', updateReady);
	});
	autoUpdater.on('error', (err) => {
		// Offline, or the feed is missing: not worth a dialog. Counted (#1940):
		// after three in a row the app's home offers the download instead of
		// waiting for a self-update that is not coming.
		updateFailures += 1;
		console.warn('update check failed:', err?.message ?? err);
	});
	// On macOS closing the window leaves the app running, and a click on the
	// Dock icon brings the window back without a launch — so a check tied to
	// launch alone can sit six hours behind a release the rider is waiting
	// for. Check when the app comes back into view too, at most once every
	// ten minutes.
	let lastCheck = 0;
	const check = (force = false) => {
		if (!force && Date.now() - lastCheck < 10 * 60 * 1000) return;
		lastCheck = Date.now();
		void autoUpdater.checkForUpdates().catch(() => {});
	};
	setTimeout(() => check(true), 15_000);
	setInterval(() => check(true), 6 * 60 * 60 * 1000);
	app.on('activate', () => check());
	app.on('browser-window-focus', () => check());
}

// The renderer asks on mount, in case the download finished before it did.
ipcMain.handle('wattroom:update-ready', () => updateReady);
// Consecutive failures of the updater (#1940): three is "not coming".
let updateFailures = 0;
ipcMain.handle('wattroom:update-failed', () => updateFailures >= 3);
ipcMain.on('wattroom:install-update', () => installUpdate());

// Restarting into the update, and why "Restart" used to just close the app.
// quitAndInstall() hands Squirrel's ShipIt a job that waits for EVERY
// instance of the bundle to go away before it touches /Applications, and it
// waits in silence: one log here sat twenty-six minutes between "install
// request" and "Beginning installation", then gave up with
//
//     Aborting update attempt because there are 1 running instances
//     Installation cancelled: … "App Still Running Error"
//
// The window had closed the moment the rider pressed the button, so what
// they saw was the app dying and never coming back — no install, no
// relaunch, no message. Electron's own quit is what ShipIt is waiting for
// and it is not guaranteed to arrive: on macOS a window can close without
// the process following it. So we do not leave the termination to chance.
// Replacing the bundle then takes ShipIt the better part of half a minute,
// and nothing can narrate that from here: a notification shown on the way out
// is withdrawn with the process (checked against the signed build — it never
// reaches Notification Center). So the sidebar's "Installing… reopens by
// itself" is the last thing the rider gets, and this is the beat that lets
// them read it.
const INSTALL_QUIT_MS = 900;
// Long enough for Squirrel to have handed ShipIt the job (the logs show it
// registering within a second), short enough that the rider is still watching.
const INSTALL_FORCE_EXIT_MS = 5000;
let installing = false;

function installUpdate() {
	if (!autoUpdater || !updateReady || installing) return;
	installing = true;
	setTimeout(() => {
		autoUpdater.quitAndInstall();
		app.quit();
		// If either of those took, this timer died with the process. Reaching
		// it means the quit was refused — and a refused quit IS the abort, so
		// exit() rather than sit here being the thing ShipIt waits for.
		setTimeout(() => app.exit(0), INSTALL_FORCE_EXIT_MS);
	}, INSTALL_QUIT_MS);
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

ipcMain.on('wattroom:hud', (event, on) => {
	// The HUD's own renderer runs the app's layout and used to answer its
	// opening with hud(false) (#1938); only the main window drives the HUD.
	if (
		hudWindow &&
		!hudWindow.isDestroyed() &&
		event.sender === hudWindow.webContents
	)
		return;
	setHud(Boolean(on));
});

// Notifications (ADR-0042). The web app's lib/notify decides WHETHER to
// notify — enabled, nobody looking — and sends the words here, because the
// shell's own Notification can do what the renderer's cannot: carry a reply
// field (macOS) and hand a click back to the app with the conversation it
// belongs to. Everything is clipped and the href must be a path on our
// origin: remote content chooses the words, never where the app goes.
const clip = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
// A path on our origin: one slash, and not a second slash OR a backslash
// behind it — the URL parser reads `/\evil` as `//evil` (#1946).
const ownPath = (v) =>
	typeof v === 'string' && v.startsWith('/') && !/^\/[\/\\]/.test(v) ? v : '';

ipcMain.on('wattroom:notify', (event, n) => {
	if (!Notification.isSupported() || !n || typeof n !== 'object') return;
	const title = clip(n.title, 120);
	if (!title) return;
	const payload = { tag: clip(n.tag, 80), href: ownPath(n.href) };
	const placeholder = clip(n.replyPlaceholder, 60);
	const note = new Notification({
		title,
		body: clip(n.body, 400),
		hasReply: placeholder !== '',
		replyPlaceholder: placeholder || undefined,
	});
	const win = BrowserWindow.fromWebContents(event.sender);
	note.on('click', () => {
		if (win && !win.isDestroyed()) {
			if (win.isMinimized()) win.restore();
			win.show();
			win.focus();
		}
		if (!event.sender.isDestroyed())
			event.sender.send('wattroom:notification', payload);
	});
	note.on('reply', (_e, reply) => {
		if (!event.sender.isDestroyed())
			event.sender.send('wattroom:notification', {
				...payload,
				// Not cut at the server's 500 (#1945): the field has no limit, and a
				// 600-character reply arrived as 500 with nothing said. Sent whole
				// (bounded far above, against a runaway paste), the server's own
				// refusal reaches the rider through the renderer's toast (#1834).
				reply: clip(reply, 4000),
			});
	});
	note.show();
});

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

function deepLinkToken(link) {
	let url;
	try {
		url = new URL(link);
	} catch {
		return null;
	}
	if (url.protocol !== 'wattroom:' || url.hostname !== 'auth') return null;
	const token = url.pathname.replace(/^\//, '');
	return DEEP_LINK_TOKEN.test(token) ? token : null;
}

// The token goes to the page over IPC (#1941), never as a navigation: the
// app decides what to do with it — redeem on /login, or say it is already
// signed in — and a ride in progress is never loaded over. Only within the
// sign-in window this shell itself opened; a link arriving cold, with no
// sign-in started here, is dropped (ponytail: a shell quit mid-sign-in
// loses the link and the rider starts again — a restart is not a session).
function openDeepLink(link) {
	const token = deepLinkToken(link);
	if (!token) return;
	if (Date.now() - signInStartedAt > SIGN_IN_WINDOW_MS) {
		console.warn(
			'wattroom:// link ignored: no sign-in was started from this app',
		);
		return;
	}
	const [win] = BrowserWindow.getAllWindows();
	if (!win || win.isDestroyed()) return;
	if (win.isMinimized()) win.restore();
	win.focus();
	win.webContents.send('wattroom:handoff', token);
}

const deepLinkIn = (argv) => argv.find((a) => a.startsWith('wattroom://'));

// Windows shows a notification only for an app with a model id; without
// this every new Notification() from the renderer is dropped on the floor.
if (process.platform === 'win32') app.setAppUserModelId('ch.wattroom.desktop');

// Packaged only (#1944): unpackaged this registered the raw Electron binary
// and took the link away from the installed app.
if (app.isPackaged) app.setAsDefaultProtocolClient('wattroom');
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
		// An explicit menu (#1943): Electron's default one shipped into the
		// frameless window, Help and all. macOS keeps the roles a Mac app
		// needs (copy and paste, reload); Windows and Linux draw none —
		// the app's own strip is the top of the window there.
		Menu.setApplicationMenu(
			process.platform === 'darwin'
				? Menu.buildFromTemplate([
						{ role: 'appMenu' },
						{ role: 'editMenu' },
						{ role: 'viewMenu' },
						{ role: 'windowMenu' },
					])
				: null,
		);
		const win = createWindow();
		watchForUpdates();
		// A cold start from a link is dropped (#1941): no sign-in was started
		// from this run, and the rider starts the sign-in again.
		if (deepLinkIn(process.argv))
			console.warn('wattroom:// link at launch ignored');
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
ipcMain.on('wattroom:retry', (event) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (win) load(win);
});
