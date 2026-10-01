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

const { app } = require('electron');

const DEEP_LINK_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

// When the app last sent the rider to the system browser to sign in
// (#1941): a wattroom:// link is accepted only for a little while after,
// so a page in the rider's browser cannot throw a riding shell onto /login.
let signInStartedAt = 0;
const SIGN_IN_WINDOW_MS = 10 * 60 * 1000;
let deps = null;

/** The app just sent the rider to the browser to sign in (the navigation guard saw it). */
function signInStarted() {
	signInStartedAt = Date.now();
}

function tokenOf(link) {
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
function open(link) {
	const token = tokenOf(link);
	if (!token) return;
	if (Date.now() - signInStartedAt > SIGN_IN_WINDOW_MS) {
		console.warn(
			'wattroom:// link ignored: no sign-in was started from this app',
		);
		return;
	}
	const win = deps.mainWindow();
	if (!win) return;
	deps.focus(win);
	win.webContents.send('wattroom:handoff', token);
}

/** The wattroom:// link a launch was handed, if any. */
const inArgv = (argv) => argv.find((a) => a.startsWith('wattroom://'));

/**
 * @param deps.mainWindow the rider's window, never the HUD
 * @param deps.focus brings a window to the rider
 */
function install(handlers) {
	deps = handlers;
	// Packaged only (#1944): unpackaged this registered the raw Electron binary
	// and took the link away from the installed app.
	if (app.isPackaged) app.setAsDefaultProtocolClient('wattroom');
	app.on('open-url', (event, link) => {
		event.preventDefault();
		open(link);
	});
}

module.exports = { install, open, inArgv, signInStarted };
