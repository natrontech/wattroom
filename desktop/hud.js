// The HUD (#296, ADR-0041): the rider's own numbers in a small frameless
// window that floats over everything else — for the rider who alt-tabbed to
// a film mid-interval. The web app opens it when a ride starts and closes it
// when the ride ends; it loads /hud on our origin, in the same session, and
// that page mirrors the riding screen through a BroadcastChannel. This
// process only decides WHEN it is visible: never while the main window is in
// front (see createWindow in main.js). The page's own close button sends
// hud(false), and it stays closed until the next ride starts.

const { BrowserWindow, screen } = require('electron');
const path = require('node:path');

const HUD_SIZE = { width: 320, height: 132 };
let hudWindow = null;
let deps = null;

/** The HUD's window while it is open, else null. */
function current() {
	return hudWindow;
}

function set(on) {
	if (!on) {
		if (hudWindow && !hudWindow.isDestroyed()) hudWindow.close();
		hudWindow = null;
		return;
	}
	if (hudWindow) return;
	const main = deps.mainWindow();
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
		// A panel is how a window floats over another app's full-screen Space
		// on macOS without the whole process becoming a UI element (#2660).
		type: process.platform === 'darwin' ? 'panel' : undefined,
		backgroundColor: '#0a0118',
		show: false,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			additionalArguments: [`--wattroom-version=${deps.version}`],
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			backgroundThrottling: false,
		},
	});
	// Above full-screen apps too, and on every desktop — that is the point.
	hudWindow.setAlwaysOnTop(true, 'floating');
	// Never the process transform (#2660): without skipTransformProcessType,
	// visibleOnFullScreen is Electron calling app.dock.hide() — WattRoom lost
	// its Dock icon, ⌘-Tab and menu bar for the rest of the run, and a rider
	// whose main window went behind another app could not get back to it.
	hudWindow.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
		skipTransformProcessType: true,
	});
	// BOTTOM-LEFT of the display the app is on, a finger's width in (#1669).
	//
	// It used to sit top-right, which is exactly where TV mode seats the
	// YouTube player (TvOverlay.svelte: `top-[3vh] right-[3vw]`, ≥240×200) —
	// and this is an alwaysOnTop OS window, so at 1920×1080 roughly 280×115 px
	// of the player was under it with nothing the page could do about it.
	// ADR-0041's focus rule does not cover it: a room on a TV with WattRoom
	// un-focused is the normal case, and un-focused is when the HUD SHOWS.
	//
	// Bottom-left is the one corner nothing else claims — TV's seat is
	// top-right and the jukebox dock's corner fallback is bottom-right.
	const { workArea } = screen.getDisplayMatching(main.getBounds());
	hudWindow.setPosition(
		workArea.x + 16,
		workArea.y + workArea.height - HUD_SIZE.height - 16,
	);
	deps.guardNavigation(hudWindow);
	hudWindow.on('closed', () => {
		hudWindow = null;
	});
	hudWindow.once('ready-to-show', () => {
		if (hudWindow && !main.isFocused()) hudWindow.showInactive();
	});
	hudWindow.loadURL(`${deps.appOrigin}/hud`).catch(() => {
		/* a HUD that cannot load is closed by the next hud(false) */
	});
}

/**
 * @param deps.ipc main.js's sender-checked ipcMain
 * @param deps.appOrigin where /hud is loaded from
 * @param deps.version the shell's version, for the preload
 * @param deps.mainWindow the rider's window, never this one
 * @param deps.guardNavigation the navigation guard every shell window gets
 */
function install({ ipc, ...rest }) {
	deps = rest;
	ipc.on('wattroom:hud', (event, on) => {
		// The HUD's own renderer runs the app's layout and used to answer its
		// opening with hud(false) (#1938); only the main window drives the HUD.
		if (
			hudWindow &&
			!hudWindow.isDestroyed() &&
			event.sender === hudWindow.webContents
		)
			return;
		set(Boolean(on));
	});
}

module.exports = { install, set, current };
