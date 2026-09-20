// The tray icon (#1313, ADR-0037).
//
// A menu-bar / system-tray presence, and the thing that makes "WattRoom is
// running without a window" a state a rider can see and get out of. Launched
// by the login item the shell opens no window at all, so without this there
// would be nothing on screen saying it is there.
//
// #1313's three items, plus one: the window, the room the app is connected
// to if there is one, quit — and the launch-at-login switch, because the
// setting that put the shell here has to be reachable from here. It is not
// the setting's only home (ux.md: nothing lives only in a menu); Settings →
// Notifications has the same switch, with the sentence explaining it.

const { app, dialog, Menu, nativeImage, Tray } = require('electron');
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
 * @param handlers `open` brings the rider's window back (creating one if the
 * login item started the shell without), `go` takes it to a path.
 * @returns whether there is a tray. False on a Linux desktop with no status
 * notifier to put one in, where `new Tray` throws — and the shell must not
 * die at launch over an icon, nor come up windowless with nowhere to be
 * clicked from. main.js opens a window instead.
 */
function install(handlers) {
	actions = handlers;
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
	// why every item has to be in it.
	tray.on('click', () => actions.open());
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
