// Self-update (#1303, ADR-0037 amended). Four shell releases in a day made
// the nudge the wrong answer: the shell now asks the releases repo on launch
// and every few hours, downloads the next release in the background, and
// installs it when the rider restarts — or quietly on quit. The feed is
// GitHub's `releases/latest/download` alias (package.json → publish), which
// is what lets the tags stay desktop-v<CalVer> instead of v<semver>. The web
// app is told when a download is ready and offers "Restart to update" at the
// top of the sidebar, which a ride never shows — so never mid-ride, by
// construction.

const { app, BrowserWindow } = require('electron');
const visibility = require('./visibility');

let updateReady = null;
let autoUpdater = null;
// Where the shell installs its own updates: only macOS (#2818), where
// Squirrel.Mac refuses anything without the Developer ID. Linux checks nothing
// but a sha512 published beside the binary, which whoever can write a release
// can also write. Windows checks Authenticode, and the Apple-signed build reads
// UnknownError on a stock Windows, so every download was refused anyway.
const selfInstalls = process.platform === 'darwin';
// Consecutive failures of the updater (#1940): three is "not coming". Only
// macOS self-installs (#2818), so elsewhere the page offers the download for
// every newer version, at once.
let updateFailures = 0;

function watch() {
	// Required here, not at the top: merely touching electron-updater's
	// autoUpdater constructs it, and it parses the app's version as semver —
	// a dev run reports Electron's own version, a packaged app reports
	// package.json's, and a malformed one crashes at launch with a dialog.
	if (!app.isPackaged) return;
	({ autoUpdater } = require('electron-updater'));
	// Elsewhere the feed is still read, and home offers the download (#2818).
	autoUpdater.autoDownload = selfInstalls;
	autoUpdater.autoInstallOnAppQuit = selfInstalls;
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

function restartIntoUpdate() {
	if (!autoUpdater || !updateReady || installing) return;
	installing = true;
	setTimeout(() => {
		// quitAndInstall closes every window before `before-quit`, and a window
		// that hides on close would refuse it (#3005).
		visibility.allowClose();
		autoUpdater.quitAndInstall();
		app.quit();
		// If either of those took, this timer died with the process. Reaching
		// it means the quit was refused — and a refused quit IS the abort, so
		// exit() rather than sit here being the thing ShipIt waits for.
		setTimeout(() => app.exit(0), INSTALL_FORCE_EXIT_MS);
	}, INSTALL_QUIT_MS);
}

/** @param deps.ipc main.js's sender-checked ipcMain */
function install({ ipc }) {
	// The renderer asks on mount, in case the download finished before it did.
	ipc.handle('wattroom:update-ready', () => updateReady);
	ipc.handle(
		'wattroom:update-failed',
		() => !selfInstalls || updateFailures >= 3,
	);
	ipc.on('wattroom:install-update', () => restartIntoUpdate());
}

module.exports = { install, watch };
