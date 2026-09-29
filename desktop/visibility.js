// Closing hides, and the page hears it (#3005, ADR-0037 amended).
//
// Where a tray exists, closing the main window hides it instead of destroying
// it — the red button, ⌘W, and the close box on Windows and Linux alike — so
// the web app keeps running: notifications, the lobby socket and deep links
// all live in the page, and a destroyed window takes them with it. Quitting is
// ⌘Q, the app menu or the tray's Quit, which all go through `before-quit`.
//
// The page is told when the window hides and shows (`wattroom:visibility`), so
// it can leave voice on a hide: a closed window is never a live mic.

const { app, Notification, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Set by every real quit — ⌘Q, the app menu, the tray — so the close that
// follows it destroys the window rather than hiding it.
let quitting = false;

/**
 * Let the next close through. Two quits close the windows BEFORE
 * `before-quit`: an update restart (autoUpdater.quitAndInstall closes every
 * window first, and a hidden one would refuse it) and the machine going down
 * (a window that will not close holds up a Windows logoff).
 */
function allowClose() {
	quitting = true;
}

app.on('before-quit', allowClose);
app.whenReady().then(() => powerMonitor.on('shutdown', allowClose));

/**
 * Whether throttling may come back: the window is hidden and no ride holds
 * the machine awake. A ride's own clock survives throttling (#51); the rest
 * of the page does not need full-rate timers nobody is looking at.
 */
function throttleIfIdle(win, rideHeld) {
	if (win.isDestroyed()) return;
	win.webContents.setBackgroundThrottling(!win.isVisible() && !rideHeld());
}

/**
 * Wire one main window.
 *
 * @param win the rider's window
 * @param opts.hides whether a close hides it (false where there is no tray,
 *   and then a close is today's close)
 * @param opts.rideHeld whether a ride holds keepAwake right now
 */
function manage(win, { hides, rideHeld }) {
	const tell = (visible) => {
		if (!win.isDestroyed()) win.webContents.send('wattroom:visibility', visible);
		throttleIfIdle(win, rideHeld);
	};
	win.on('show', () => tell(true));
	win.on('hide', () => tell(false));
	if (!hides) return;
	win.on('session-end', allowClose); // Windows logoff and shutdown
	win.on('close', (event) => {
		if (quitting) return;
		event.preventDefault();
		hideLeavingFullScreen(win);
		announceOnce();
	});
}

/**
 * Hide, leaving native fullscreen first: a fullscreen window ordered out on
 * macOS leaves its Space behind, black, until the rider swipes away (#3510).
 */
function hideLeavingFullScreen(win) {
	if (!win.isFullScreen()) return win.hide();
	win.once('leave-full-screen', () => win.hide());
	win.setFullScreen(false);
}

/**
 * Windows and Linux say once that the window went to the tray (#3005): there
 * the close box has always meant quit, and an app that stays running needs to
 * say so the first time. macOS riders already expect a closed window to leave
 * the app in the Dock. Remembered in userData, so "once" survives a restart.
 */
function announceOnce() {
	if (process.platform === 'darwin' || !Notification.isSupported()) return;
	const seen = path.join(app.getPath('userData'), 'tray-notice');
	if (fs.existsSync(seen)) return;
	try {
		fs.writeFileSync(seen, '');
	} catch {
		/* a notice shown twice beats one never shown */
	}
	new Notification({
		title: 'WattRoom is still running',
		body: 'It is in the tray, so messages and session reminders still reach you. Quit it from there.',
	}).show();
}

module.exports = { manage, throttleIfIdle, allowClose };
