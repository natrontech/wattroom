// Notifications (ADR-0042). The web app's lib/notify decides WHETHER to
// notify — enabled, nobody looking — and sends the words here, because the
// shell's own Notification can do what the renderer's cannot: carry a reply
// field (macOS) and hand a click back to the app with the conversation it
// belongs to. Everything is clipped and the href must be a path on our
// origin: remote content chooses the words, never where the app goes.

const { BrowserWindow, Notification } = require('electron');
const path = require('node:path');

const clip = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
// A path on our origin: one slash, and not a second slash OR a backslash
// behind it — the URL parser reads `/\evil` as `//evil` (#1946).
// The web app asks the same of its paths in web/src/lib/same-origin.ts.
const ownPath = (v) =>
	typeof v === 'string' && v.startsWith('/') && !/^\/[\/\\]/.test(v) ? v : '';

// Every notification still showing, by tag (#3001). A Notification nothing
// references is garbage collected with its listeners, and a click on it in
// Notification Center then only activates the app: the conversation never
// opened. One per tag, as the web's own Notification does: the newer line
// replaces the older one rather than leaving a dead one behind it.
// ponytail: never pruned; one entry per conversation that ever notified.
const shown = new Map();

/**
 * @param deps.ipc main.js's sender-checked ipcMain
 * @param deps.focus brings a window to the rider
 */
function install({ ipc, focus }) {
	ipc.on('wattroom:notify', (event, n) => {
		if (!Notification.isSupported() || !n || typeof n !== 'object') return;
		const title = clip(n.title, 120);
		if (!title) return;
		const payload = { tag: clip(n.tag, 80), href: ownPath(n.href) };
		const placeholder = clip(n.replyPlaceholder, 60);
		const note = new Notification({
			title,
			body: clip(n.body, 400),
			hasReply: placeholder !== '',
			replyPlaceholder: placeholder || undefined,
			// Named, never a path: the renderer picks from what the shell bundles
			// (#2696), so remote content cannot point it at a file.
			icon:
				n.icon === 'chat'
					? path.join(__dirname, 'icons', 'chat.png')
					: undefined,
		});
		const win = BrowserWindow.fromWebContents(event.sender);
		note.on('click', () => {
			focus(win);
			if (!event.sender.isDestroyed())
				event.sender.send('wattroom:notification', payload);
		});
		note.on('reply', (_e, reply) => {
			if (!event.sender.isDestroyed())
				event.sender.send('wattroom:notification', {
					...payload,
					// Not cut at the server's 500 (#1945): the field has no limit, and a
					// 600-character reply arrived as 500 with nothing said. Sent whole
					// (bounded far above, against a runaway paste), the server's own
					// refusal reaches the rider through the renderer's toast (#1834).
					reply: clip(reply, 4000),
				});
		});
		shown.get(payload.tag)?.close();
		shown.set(payload.tag, note);
		note.show();
	});
}

module.exports = { install, clip, ownPath };
