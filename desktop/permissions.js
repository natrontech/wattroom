// Permissions and screen share (RESEARCH.md §15.1): the second and third of
// the handlers Electron makes mandatory. Electron's default is to allow, and
// it implements no getDisplayMedia, so each of these is something Chrome does
// for you and whose absence looks like a bug in WattRoom. Wired in by main.js:
// `install` once, `attach` on the rider's window.

const { desktopCapturer } = require('electron');
const { chooseFrom } = require('./chooser');

let deps = null;

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

/** The permission gate and the screen picker on this window's session. */
function attach(win) {
	const { appOrigin: APP_ORIGIN, isOurs } = deps;
	const ses = win.webContents.session;

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
}

/**
 * @param deps.appOrigin the one origin that may hold a permission
 * @param deps.isOurs whether a URL is on it
 */
function install({ appOrigin, isOurs }) {
	deps = { appOrigin, isOurs };
}

module.exports = { install, attach };
