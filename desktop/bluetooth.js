// The Bluetooth chooser (#1545, #1716, RESEARCH.md §15.1): the first of the
// handlers Electron makes mandatory. Electron ships no chooser at all, so the
// shell owns the scan — when it is answered, and what the app is told — and
// the app draws the picker. Wired in by main.js: `install` once, `attach` on
// the rider's window, `warm` once it has loaded.

const { app } = require('electron');
const { chooseFrom } = require('./chooser');

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

/**
 * The Bluetooth request currently open, if any.
 *
 * Chromium runs one chooser at a time and cancels the old one when a new
 * request starts, so a single slot is the whole state machine. Module scope
 * rather than per-window, like the shell's IPC handlers: the rider's
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

// True only for the launch warm-up (warm), so its chooser is answered
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
function warm(win) {
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

/** Answer the chooser on this window: held open, streamed to the app. */
function attach(win) {
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

		// The launch warm-up (warm) is a request nobody asked for: never put a
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
}

/** @param deps.ipc main.js's sender-checked ipcMain */
function install({ ipc }) {
	// Registering the listener is the app saying it can draw the picker.
	ipc.on('wattroom:ble-picker-ready', () => {
		pickerReady = true;
	});

	// The rider picked, or closed the picker. Ignored when no request is open:
	// a stale answer must never settle the NEXT one.
	ipc.on('wattroom:ble-pick', (_event, deviceId) =>
		settleScan(deviceId || ''),
	);
}

module.exports = { install, attach, warm };
