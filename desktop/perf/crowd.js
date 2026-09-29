// The other riders in `make perf-scenes` (#3039). A process of its own, so
// their rendering, encoding and GPU work never land in the measured viewer's
// numbers; offscreen windows at a low frame rate, so they never land in
// WindowServer's either. scenes.js drives it with one JSON command per line
// on stdin and reads one JSON answer per line on stdout.
const { app, BrowserWindow } = require('electron');
const readline = require('node:readline');
const { quietApp, load, sleep } = require('./sample');
const { must, press, signIn, fakeMedia, VOICE } = require('./page');

quietApp('wattroom-perf-crowd-profile');
fakeMedia(app);

const BASE = process.env.PERF_URL.replace(/\/$/, '');
const riders = new Map();

/** A code editor's worth of changing text at the rate a real share arrived
 *  (6 fps, #2998), drawn on the CPU so the crowd's GPU stays out of it. */
const FAKE_SCREEN = `
	navigator.mediaDevices.getDisplayMedia = async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 1920; canvas.height = 1080;
		const g = canvas.getContext('2d', { willReadFrequently: true });
		let frame = 0;
		setInterval(() => {
			g.fillStyle = '#1e1e1e'; g.fillRect(0, 0, 1920, 1080);
			g.font = '18px monospace';
			for (let line = 0; line < 49; line++) {
				g.fillStyle = ['#9cdcfe', '#ce9178', '#569cd6', '#6a9955'][(line + frame) % 4];
				g.fillText((line + frame) % 400 + '  const value' + line + ' = compute(' + frame + ');', 40, 30 + line * 21);
			}
			frame++;
		}, 1000 / 6);
		const stream = canvas.captureStream(6);
		stream.getVideoTracks()[0].contentHint = 'detail';
		return stream;
	};
	undefined;`;

async function inVoice(r) {
	await load(r.win, `${BASE}${r.voicePath}`);
	await r.win.webContents.executeJavaScript(VOICE);
	if (r.screen) await r.win.webContents.executeJavaScript(FAKE_SCREEN);
	await press(r.win, 'Join voice');
}

const commands = {
	async join({ name, code, voicePath, screen = false }) {
		const win = new BrowserWindow({
			show: false,
			webPreferences: {
				offscreen: true,
				partition: `persist:perf-${name}`,
				backgroundThrottling: false,
			},
		});
		win.webContents.setFrameRate(5);
		const r = { win, voicePath, screen };
		riders.set(name, r);
		const me = await signIn(win, BASE, name);
		// Idempotent: a member from an earlier run joins again with a 200.
		await must(win, 'POST', '/api/crews/join', { code }, `${name} joining`);
		await inVoice(r);
		return { id: me.id };
	},
	async status({ name, emojiId }) {
		await must(
			riders.get(name).win,
			'PUT',
			'/api/me/status',
			{ emojiId, text: 'on the bike' },
			`${name}'s status`,
		);
	},
	async clearStatus({ name }) {
		await must(
			riders.get(name).win,
			'DELETE',
			'/api/me/status',
			undefined,
			`${name}'s status`,
		);
	},
	async ride({ name }) {
		// The lounge's own link, so the rider stays in voice on the way.
		const r = riders.get(name);
		await press(r.win, 'Free ride');
		await press(r.win, 'Ride simulated', 30_000);
	},
	async speak({ name, on }) {
		await riders
			.get(name)
			.win.webContents.executeJavaScript(`window.__perfSpeak = ${on};`);
	},
	async share({ name }) {
		await press(riders.get(name).win, 'share screen');
		await sleep(1500);
	},
	async quit() {
		for (const r of riders.values()) r.win.destroy();
		setTimeout(() => app.exit(0), 100);
	},
};

app.whenReady().then(() => {
	const lines = readline.createInterface({ input: process.stdin });
	lines.on('line', async (line) => {
		const { id, cmd, args } = JSON.parse(line);
		try {
			const value = await commands[cmd](args ?? {});
			process.stdout.write(JSON.stringify({ id, ok: true, value }) + '\n');
		} catch (err) {
			process.stdout.write(
				JSON.stringify({ id, ok: false, error: err.message }) + '\n',
			);
		}
	});
	// The runner gone — finished or failed — closes this pipe: leave with it.
	lines.on('close', () => app.exit(0));
	process.stdout.write(
		JSON.stringify({ id: 0, ok: true, value: 'ready' }) + '\n',
	);
});
