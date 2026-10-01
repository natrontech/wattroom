// The tray icon (#1313, ADR-0037).
//
// A menu-bar / system-tray presence, and the thing that makes "WattRoom is
// running without a window" a state a rider can see and get out of. Launched
// by the login item, or with its window closed, the shell runs with its window
// hidden (#3005), so without this there would be nothing on screen saying it
// is there.
//
// #1313's three items, plus one: the window, the room the app is connected
// to if there is one, quit — and the launch-at-login switch, because the
// setting that put the shell here has to be reachable from here. It is not
// the setting's only home (ux.md: nothing lives only in a menu); Settings →
// Notifications has the same switch, with the sentence explaining it.

const { app, dialog, Menu, nativeImage, Tray } = require('electron');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const loginItem = require('./login-item');

/** Held at module scope: a Tray that nothing references is garbage collected off the bar. */
let tray = null;
/** `{ path, name }` of the room the app is connected to, or null. */
let room = null;
let actions = { open: () => {}, go: () => {} };

/**
 * macOS wants a template image — black with alpha, which the system tints
 * for a light or dark menu bar and inverts under selection. Colour there is
 * the one thing that reads as "not a Mac app". Everywhere else the mark is
 * the mark. `@2x` beside each file is picked up by name.
 */
function trayImage() {
	const mac = process.platform === 'darwin';
	const image = nativeImage.createFromPath(
		path.join(__dirname, 'icons', mac ? 'trayTemplate.png' : 'tray.png'),
	);
	if (mac) image.setTemplateImage(true);
	return image;
}

/** A room name is the rider's, and a menu item is not where they find out how long one may be. */
function short(name) {
	return name.length > 40 ? `${name.slice(0, 39)}…` : name;
}

function setLaunchAtLogin(on) {
	const problem = loginItem.setEnabled(on);
	// errors.md: a deliberate tap that a rider watches for a result answers
	// when it is refused. A tray has no slot to answer in, and the tick would
	// otherwise sit there with nothing behind it.
	if (problem) dialog.showErrorBox('Launch at login', problem);
	refresh();
}

/** What the menu is showing, as a template. Also what the smoke test reads. */
function menuTemplate() {
	const login = loginItem.state();
	const sections = [
		[
			{ label: 'Open WattRoom', click: () => actions.open() },
			...(room
				? [
						{
							label: `Open ${short(room.name)}`,
							click: () => actions.go(room.path),
						},
					]
				: []),
		],
		login.supported
			? [
					{
						label: 'Launch at login',
						type: 'checkbox',
						checked: login.enabled,
						click: (item) => setLaunchAtLogin(item.checked === true),
					},
				]
			: [],
		[{ label: 'Quit WattRoom', click: () => app.quit() }],
	].filter((section) => section.length > 0);
	return sections.flatMap((section, i) =>
		i === 0 ? section : [{ type: 'separator' }, ...section],
	);
}

function refresh() {
	if (!tray || tray.isDestroyed()) return;
	tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

/**
 * Whether a Linux desktop will draw a tray icon: something owns
 * org.kde.StatusNotifierWatcher on the session bus (#3510). `new Tray` cannot
 * say: it never throws for a missing host, it falls back to drawing nowhere.
 * GNOME Shell without the AppIndicator extension is the common case. No bus,
 * no answer or no probe to ask with all read as no tray, the side where a
 * close still quits.
 *
 * ponytail: asked once, at launch. A panel that registers after the shell
 * started leaves that run on close-quits; ask again on show if riders hit it.
 */
function linuxHasTrayHost() {
	const ask = 'org.freedesktop.DBus.NameHasOwner';
	const name = 'org.kde.StatusNotifierWatcher';
	const probes = [
		[
			'gdbus',
			`call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method ${ask} ${name}`,
		],
		[
			'dbus-send',
			`--session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus ${ask} string:${name}`,
		],
	];
	for (const [cmd, args] of probes) {
		try {
			// gdbus answers "(true,)", dbus-send "boolean true".
			const out = execFileSync(cmd, args.split(' '), {
				encoding: 'utf8',
				timeout: 1000,
			});
			return /\btrue\b/.test(out);
		} catch (err) {
			if (err.code !== 'ENOENT') return false; // asked, and no bus answered
		}
	}
	return false;
}

/**
 * @param handlers `open` brings the rider's window back (showing it if it is
 * hidden, creating one if there is none), `go` takes it to a path.
 * @returns whether there is a tray. False where there is nowhere to draw one —
 * a Linux desktop with no status notifier host, or a `new Tray` that throws —
 * and the shell must not come up windowless with nowhere to be clicked from,
 * nor hide a window the rider cannot get back. main.js opens a window instead,
 * and a close quits.
 */
function install(handlers) {
	actions = handlers;
	if (process.platform === 'linux' && !linuxHasTrayHost()) {
		console.warn('no status notifier host: no tray, and a close quits');
		return false;
	}
	try {
		tray = new Tray(trayImage());
	} catch (err) {
		console.warn('no system tray here:', err?.message ?? err);
		tray = null;
		return false;
	}
	tray.setToolTip('WattRoom');
	// Windows is the only platform where a left click can mean "open the
	// window": on macOS a click opens the menu, and Linux's AppIndicator has
	// no click event at all — the menu is the whole interface there, which is
	// why every item has to be in it. On macOS the click fires beside the
	// menu, and the window it raised took the menu away (#3001).
	if (process.platform === 'win32') tray.on('click', () => actions.open());
	refresh();
	return true;
}

/** The room the app is connected to, or null when it is connected to none. */
function setRoom(next) {
	if (next?.path === room?.path && next?.name === room?.name) return;
	room = next;
	refresh();
}

module.exports = { install, setRoom, refresh, menuTemplate };
