// Closing hides, and the page hears it (#3005, ADR-0037 amended).
//
// Where a tray exists, closing the main window hides it instead of destroying
// it — the red button, ⌘W, and the close box on Windows and Linux alike — so
// the web app keeps running: notifications, the lobby socket and deep links
// all live in the page, and a destroyed window takes them with it. Quitting is
// ⌘Q, the app menu or the tray's Quit, which all go through `before-quit`.
//
// The page is told when a close hides the window and when it comes back
// (`wattroom:visibility`), so it can leave voice: a closed window is never a
// live mic. Only a close says so (#3509). macOS also fires 'hide' whenever the
// window is minimised, covered, behind a fullscreen app, on another Space or
// on a sleeping display, and a rider behind a film is still in the call.

const { app, Notification, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Set by every real quit — ⌘Q, the app menu, the tray — so the close that
// follows it destroys the window rather than hiding it.
let quitting = false;

// Windows a close put in the tray, until they are shown again, and how each
// one tells its page.
const closedToTray = new WeakSet();
const tellers = new WeakMap();

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
 * Whether throttling may come back: a close put the window in the tray and
 * no ride holds the machine awake. A ride's own clock survives throttling
 * (#51); the rest of the page does not need full-rate timers nobody is
 * looking at. A covered or minimised window is not closed, and keeps them.
 */
function throttleIfIdle(win, rideHeld) {
	if (win.isDestroyed()) return;
	win.webContents.setBackgroundThrottling(
		closedToTray.has(win) && !rideHeld(),
	);
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
	if (!hides) return;
	tellers.set(win, tell);
	// On macOS 'show' tracks occlusion and may never come for a window that
	// reopens under another one, so the ways back call shown() themselves.
	win.on('show', () => shown(win));
	win.on('session-end', allowClose); // Windows logoff and shutdown
	win.on('close', (event) => {
		if (quitting) return;
		event.preventDefault();
		closedToTray.add(win);
		hideLeavingFullScreen(win);
		tell(false);
		announceOnce();
	});
}

/**
 * The rider brought the window back — the tray, the Dock, a second launch, a
 * notification. The page hears it only if a close had put the window away;
 * uncovering a covered window is no news (#3509).
 */
function shown(win) {
	if (closedToTray.delete(win)) tellers.get(win)?.(true);
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

module.exports = { manage, shown, throttleIfIdle, allowClose };
