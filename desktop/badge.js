// The unread badge (#3008): the count the sidebar already shows, on the Dock
// and the taskbar icon — Discord, Slack and Mail all badge theirs. The web app
// sends the number (its sidebar's own, summed); the shell only draws it.

const { app, nativeImage } = require('electron');

/** Past this the badge is a number nobody reads, only "a lot". */
const MOST = 999;

/** A number from the page, made safe to hand the OS: a whole count, 0 … 999. */
function clamp(n) {
	return Number.isInteger(n) && n > 0 ? Math.min(n, MOST) : 0;
}

/**
 * Windows has no badge count, only a taskbar overlay: a neon dot, drawn here
 * rather than shipped, so there is no asset to keep in step with the theme.
 */
let dot = null;
function overlay() {
	if (dot) return dot;
	const size = 16;
	const bgra = Buffer.alloc(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const dx = x - 7.5;
			const dy = y - 7.5;
			if (dx * dx + dy * dy > 7 * 7) continue;
			// --color-neon, #8b2bff, as BGRA.
			bgra.set([0xff, 0x2b, 0x8b, 0xff], (y * size + x) * 4);
		}
	dot = nativeImage.createFromBitmap(bgra, { width: size, height: size });
	return dot;
}

/** Show `n` on the icon: a count on macOS and Linux, a dot on Windows. */
function set(n, win) {
	const count = clamp(n);
	if (process.platform === 'win32') {
		if (win && !win.isDestroyed())
			win.setOverlayIcon(
				count ? overlay() : null,
				count ? `${count} unread` : '',
			);
		return;
	}
	app.setBadgeCount(count);
}

module.exports = { set, clamp };
