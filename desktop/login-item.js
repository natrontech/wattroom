// Launch at login (#1313, RESEARCH.md §15.4).
//
// Two mechanisms, because Electron only has one and it covers two of the
// three platforms: `app.setLoginItemSettings` is macOS and Windows, and
// Linux means writing `~/.config/autostart/wattroom.desktop` ourselves.
//
// Off unless the rider asks for it (ux.md's 95 % rule: nobody expects a
// cycling app in their login items), never turned on by an install, and
// reversible from the two places that can turn it on — Settings and the
// tray — so undoing a click never means editing OS config.
//
// A login launch opens no window: the shell starts in the tray, because a
// window in the rider's face at every boot is what makes people turn this
// back off. HIDDEN_FLAG is how the launch says so.

const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * What a login launch passes, and what main.js reads to stay windowless.
 *
 * macOS has nowhere to put it — `setLoginItemSettings`'s `args` is Windows
 * only — so there the same question is asked of the system instead, in
 * startedByLoginItem below.
 */
const HIDDEN_FLAG = '--hidden';

const AUTOSTART_NAME = 'wattroom.desktop';

/** XDG's autostart directory. The env var wins, which is also what lets the smoke test point this somewhere disposable. */
function autostartFile() {
	const base =
		process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
	return path.join(base, 'autostart', AUTOSTART_NAME);
}

/**
 * The command a login item has to run.
 *
 * Inside an AppImage `process.execPath` is the binary in the squashfs mount
 * under `/tmp`, which is gone by the next boot — `APPIMAGE` is the path to
 * the file the rider actually keeps. And an unpackaged run needs the app
 * directory as an argument, or the login item starts a bare Electron.
 */
function launchArgv() {
	const exe =
		(process.platform === 'linux' && process.env.APPIMAGE) || process.execPath;
	return app.isPackaged
		? [exe, HIDDEN_FLAG]
		: [exe, app.getAppPath(), HIDDEN_FLAG];
}

/**
 * Desktop Entry quoting. The paths are quoted — a rider's home directory may
 * have a space in it — with the four characters that keep their meaning
 * inside double quotes escaped. A switch is left bare, so the line reads as
 * the command it is to whoever opens the file.
 */
function quote(arg) {
	if (arg === HIDDEN_FLAG) return arg;
	return `"${arg.replace(/(["$`\\])/g, '\\$1')}"`;
}

function desktopEntry() {
	return `${[
		'[Desktop Entry]',
		'Type=Application',
		'Name=WattRoom',
		'Comment=Collaborative indoor cycling',
		`Exec=${launchArgv().map(quote).join(' ')}`,
		'Icon=wattroom',
		'Terminal=false',
		'X-GNOME-Autostart-enabled=true',
	].join('\n')}\n`;
}

/**
 * Windows takes an explicit executable and arguments, and
 * `getLoginItemSettings` has to be asked with the same pair or it looks for
 * a different Run entry than the one we wrote. Only the paths are quoted —
 * a quoted switch is a switch the app would have to unquote.
 */
function windowsSettings() {
	const [, ...args] = launchArgv();
	return {
		path: process.execPath,
		args: args.map((a) => (a === HIDDEN_FLAG ? a : `"${a}"`)),
	};
}

/**
 * Whether this build can add itself to the login items, and whether it has.
 *
 * `supported: false` hides the control rather than offering one that fails
 * on click (ux.md). The one case that is not a platform: an unpackaged run
 * on macOS, where this API registers the prebuilt Electron bundle — #1944's
 * trap in a different API, and worse here, because what it registers is not
 * WattRoom and cannot be un-registered from inside WattRoom either.
 */
function state() {
	if (process.platform === 'linux') {
		return { supported: true, enabled: fs.existsSync(autostartFile()) };
	}
	if (process.platform === 'darwin' && !app.isPackaged) {
		return { supported: false, enabled: false };
	}
	if (process.platform !== 'darwin' && process.platform !== 'win32') {
		return { supported: false, enabled: false };
	}
	try {
		const opts = process.platform === 'win32' ? windowsSettings() : {};
		return {
			supported: true,
			enabled: app.getLoginItemSettings(opts).openAtLogin === true,
		};
	} catch (err) {
		console.warn('login items unreadable:', err?.message ?? err);
		return { supported: false, enabled: false };
	}
}

/**
 * Turn it on or off.
 *
 * @returns null when it took, or one sentence saying what did not and what
 * the rider can do instead (errors.md). The details go to the log; the
 * rider gets an answer they can act on.
 */
function setEnabled(on) {
	if (!state().supported) {
		return 'This build cannot change your login items. Start WattRoom from your system’s own startup settings instead.';
	}
	try {
		if (process.platform === 'linux') {
			const file = autostartFile();
			if (on) {
				fs.mkdirSync(path.dirname(file), { recursive: true });
				fs.writeFileSync(file, desktopEntry());
			} else {
				fs.rmSync(file, { force: true });
			}
		} else {
			app.setLoginItemSettings({
				openAtLogin: on,
				...(process.platform === 'win32' ? windowsSettings() : {}),
			});
		}
	} catch (err) {
		console.warn('login item not changed:', err?.message ?? err);
		return on
			? 'WattRoom could not add itself to your login items. Add it in your system’s startup settings.'
			: 'WattRoom could not remove itself from your login items. Remove it in your system’s startup settings.';
	}
	// Read it back rather than trust the call. On macOS 13 and up this goes
	// through SMAppService, which can register nothing and say nothing — the
	// rider approves login items in System Settings, and a switch that sits
	// on with nothing behind it is the failure this whole feature would be
	// remembered for.
	if (state().enabled !== on) {
		return on
			? 'Your system did not add WattRoom to your login items. Allow it there, then try again.'
			: 'Your system kept WattRoom in your login items. Remove it in your system’s startup settings.';
	}
	return null;
}

/**
 * Whether this launch is the login item's, so the shell opens no window.
 *
 * macOS gets no argument to read, so the system is asked instead — and only
 * in a packaged build, because an unpackaged one is never a login item (see
 * state above).
 */
function startedByLoginItem() {
	if (process.argv.includes(HIDDEN_FLAG)) return true;
	if (process.platform !== 'darwin' || !app.isPackaged) return false;
	try {
		return app.getLoginItemSettings().wasOpenedAtLogin === true;
	} catch {
		return false;
	}
}

module.exports = { state, setEnabled, startedByLoginItem };
