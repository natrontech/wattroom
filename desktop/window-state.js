// Where the window was (#1948): size, position and whether it was maximized
// or fullscreen, kept in userData and restored only when the saved rect still
// lands on a display that is here — a monitor that went with the rider's desk
// keeps the size and drops the position. Saved as it changes, not only on
// close (#3013): a crash, a force-quit or a power cut mid-ride keeps it too.
// The HUD places itself (ADR-0041).

const { app, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SETTLE_MS = 500;

function file() {
	return path.join(app.getPath('userData'), 'window.json');
}

/** What was saved last, or null. */
function read() {
	try {
		const s = JSON.parse(fs.readFileSync(file(), 'utf8'));
		if (typeof s.width === 'number' && typeof s.height === 'number') return s;
	} catch {
		/* first launch, or a file nobody wrote */
	}
	return null;
}

function onADisplay(b) {
	return screen.getAllDisplays().some(({ workArea: a }) => {
		return (
			b.x < a.x + a.width &&
			b.x + b.width > a.x &&
			b.y < a.y + a.height &&
			b.y + b.height > a.y
		);
	});
}

/** Where a new window opens: the saved rect if it is still on a display, else only its size. */
function bounds(saved) {
	return saved &&
		typeof saved.x === 'number' &&
		typeof saved.y === 'number' &&
		onADisplay(saved)
		? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
		: { width: saved?.width ?? 1280, height: saved?.height ?? 860 };
}

function save(win) {
	if (win.isDestroyed()) return;
	try {
		const maximized = win.isMaximized();
		const fullScreen = win.isFullScreen();
		// Maximized, fullscreen or minimized, the bounds to come back to are the normal ones.
		const normal =
			maximized || fullScreen || win.isMinimized()
				? win.getNormalBounds()
				: win.getBounds();
		fs.writeFileSync(
			file(),
			JSON.stringify({ ...normal, maximized, fullScreen }),
		);
	} catch (err) {
		console.warn('window state not saved:', err?.message ?? err);
	}
}

/** Save the window's state as it changes, and once more as it closes. */
function track(win) {
	// A drag or a resize fires on every frame of it; the state is written once it settles.
	let settling = null;
	const saveSoon = () => {
		clearTimeout(settling);
		settling = setTimeout(() => save(win), SETTLE_MS);
	};
	// Maximizing and going fullscreen resize the window too, so they are saved the same way.
	win.on('resize', saveSoon);
	win.on('move', saveSoon);
	win.on('close', () => {
		clearTimeout(settling);
		save(win);
	});
}

module.exports = { read, bounds, track };
