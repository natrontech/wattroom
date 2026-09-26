// `make perf-scenes` (#3039): what the real app costs on the screens a rider
// sits in front of — a crew's voice channel with people in it, their
// statuses, someone riding, someone talking, a screen share on the stage,
// and finally the rider's own ride. Where `make perf` isolates one element,
// this measures the sum, so the two together say what a fix is worth.
//
// The measured viewer is this process's one visible window. The crew around
// it lives in crowd.js, a second Electron process with offscreen windows, so
// none of their work is counted here. Scenes build on each other in order;
// each is measured on every display by moving the window, not reloading it.
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const perf = require('./sample');
const { must, press, signIn, fakeMedia, VOICE } = require('./page');

perf.quietApp('wattroom-perf-scenes-profile');
fakeMedia(app);

const CREW = 'Perf Bench';
const EMOJI = 'perf_orbit';
const VIEWER = 'Perf Viewer';
const RIDER = 'Perf Rider';
const TALKER = 'Perf Talker';
const SHARER = 'Perf Sharer';
/** How long a scene runs before the first display is sampled: a share has
 *  to ramp up, a status has to reach the roster. */
const SCENE_SETTLE_MS = 4000;

/** crowd.js, one command at a time over its stdin. */
function startCrowd() {
	const child = spawn(process.execPath, [path.join(__dirname, 'crowd.js')], {
		stdio: ['pipe', 'pipe', 'inherit'],
		env: { ...process.env, PERF_URL: perf.BASE },
	});
	process.on('exit', () => child.kill());
	const waiting = new Map();
	let next = 1;
	readline.createInterface({ input: child.stdout }).on('line', (line) => {
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			return; // Chromium's own chatter on stdout
		}
		const done = waiting.get(msg.id);
		if (!done) return;
		waiting.delete(msg.id);
		if (msg.ok) done.resolve(msg.value);
		else done.reject(new Error(`crowd: ${msg.error}`));
	});
	const ready = new Promise((resolve, reject) =>
		waiting.set(0, { resolve, reject }),
	);
	const send = (cmd, args) =>
		new Promise((resolve, reject) => {
			const id = next++;
			waiting.set(id, { resolve, reject });
			child.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
		});
	return { ready, send, child };
}

/** The crew, its Lounge voice channel and an animated crew emoji — made once
 *  by the viewer, who owns the crew, and reused by every later run. */
async function world(win) {
	const mine = await must(win, 'GET', '/api/crews', undefined, 'crews');
	let crew = mine.crews?.find((c) => c.name === CREW && c.role === 'owner');
	if (!crew)
		crew = await must(
			win,
			'POST',
			'/api/crews',
			{ name: CREW },
			'founding the crew',
		);
	const { code } = await must(
		win,
		'GET',
		`/api/crews/${crew.id}`,
		undefined,
		'the crew',
	);
	const { channels } = await must(
		win,
		'GET',
		`/api/crews/${crew.id}/channels`,
		undefined,
		'channels',
	);
	const voice = channels.find((c) => c.kind === 'voice' && c.name === 'Lounge');
	const listed = await must(
		win,
		'GET',
		`/api/crews/${crew.id}/emoji`,
		undefined,
		'emoji',
	);
	let emoji = (listed.emoji ?? listed).find?.((e) => e.name === EMOJI);
	if (!emoji) {
		const gif = fs
			.readFileSync(path.join(__dirname, 'fixtures', 'status-emoji.gif'))
			.toString('base64');
		emoji = await win.webContents.executeJavaScript(`(async () => {
			const bytes = Uint8Array.from(atob(${JSON.stringify(gif)}), (c) => c.charCodeAt(0));
			const res = await fetch('/api/crews/${crew.id}/emoji?name=${EMOJI}', { method: 'POST', body: new Blob([bytes], { type: 'image/gif' }) });
			if (!res.ok) throw new Error('emoji upload: ' + res.status + ' ' + (await res.text()));
			return res.json();
		})()`);
	}
	return {
		crew: crew.id,
		code,
		voicePath: `/crew/${crew.id}/v/${voice.id}`,
		emojiId: emoji.id,
	};
}

/** What the page is playing, for the report's video column. */
const VIDEO = `[...document.querySelectorAll('video')].filter((v) => v.videoWidth).map((v) => ({ size: v.videoWidth + 'x' + v.videoHeight, frames: v.getVideoPlaybackQuality().totalVideoFrames }))`;

async function sampleOn(win, display, label, noise) {
	win.setBounds(display.workArea);
	await perf.sleep(perf.SETTLE_MS);
	const video0 = await win.webContents.executeJavaScript(VIDEO);
	const t0 = performance.now();
	const r = { case: label, ...(await perf.sampleApp(win, { noise })) };
	const video1 = await win.webContents.executeJavaScript(VIDEO);
	const secs = (performance.now() - t0) / 1000;
	if (video1.length)
		r.video = video1
			.map(
				(v, i) =>
					`${v.size} ${perf.round((v.frames - (video0[i]?.frames ?? 0)) / secs)} fps`,
			)
			.join(', ');
	return r;
}

perf.start('perf-scenes', async () => {
	const displays = perf.selectDisplays();
	fs.mkdirSync(perf.OUT, { recursive: true });
	const jsonl = fs.createWriteStream(path.join(perf.OUT, 'results.jsonl'));
	const results = new Map(displays.map((d) => [d.id, []]));
	const noise = new Map(displays.map((d) => [d.id, []]));
	const record = (display, r) => {
		results.get(display.id).push(r);
		jsonl.write(JSON.stringify({ display: display.label, ...r }) + '\n');
		console.log(perf.progress(`${display.label.slice(0, 12)} ${r.case}`, r));
	};

	const win = new BrowserWindow({
		...displays[0].workArea,
		alwaysOnTop: true,
		backgroundColor: '#0a0118',
		webPreferences: { backgroundThrottling: false },
	});
	win.setAlwaysOnTop(true, 'floating');

	const baseline = async () => {
		await perf.load(win, `${perf.BASE}/dev/perf?case=none`);
		for (const d of displays)
			record(
				d,
				await sampleOn(
					win,
					d,
					'none',
					results.get(d.id).length ? null : noise.get(d.id),
				),
			);
	};
	console.log('baseline');
	await baseline();

	console.log('building the crew');
	const crowd = startCrowd();
	await crowd.ready;
	await signIn(win, perf.BASE, VIEWER);
	const w = await world(win);
	await crowd.send('join', {
		name: RIDER,
		code: w.code,
		voicePath: w.voicePath,
	});
	await crowd.send('join', {
		name: TALKER,
		code: w.code,
		voicePath: w.voicePath,
	});
	await crowd.send('join', {
		name: SHARER,
		code: w.code,
		voicePath: w.voicePath,
		screen: true,
	});
	for (const name of [RIDER, TALKER, SHARER])
		await crowd.send('clearStatus', { name });
	await perf.load(win, `${perf.BASE}${w.voicePath}`);
	await win.webContents.executeJavaScript(VOICE);
	await press(win, 'Join voice');

	const scenes = [
		['lounge, 4 in voice', async () => {}],
		[
			'+ animated emoji statuses',
			async () => {
				for (const name of [RIDER, TALKER, SHARER])
					await crowd.send('status', { name, emojiId: w.emojiId });
			},
		],
		['+ one rider riding', () => crowd.send('ride', { name: RIDER })],
		[
			'+ one rider talking',
			() => crowd.send('speak', { name: TALKER, on: true }),
		],
		['+ screen share on stage', () => crowd.send('share', { name: SHARER })],
		[
			'+ you ride (Training)',
			async () => {
				await press(win, 'Free ride');
				await press(win, 'Ride simulated', 30_000);
			},
		],
	];
	for (const [i, [label, apply]] of scenes.entries()) {
		console.log(label);
		await apply();
		await perf.sleep(SCENE_SETTLE_MS);
		for (const d of displays) record(d, await sampleOn(win, d, label));
		// What was on screen, so a number can be checked against the scene.
		const shot = `scene-${i + 1}-${label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.png`;
		fs.writeFileSync(
			path.join(perf.OUT, shot),
			(await win.webContents.capturePage()).toPNG(),
		);
	}

	await crowd.send('quit').catch(() => {});
	console.log('baseline');
	await baseline();

	const sections = displays.map((d) =>
		perf.report(d, results.get(d.id), noise.get(d.id)),
	);
	fs.writeFileSync(
		path.join(perf.OUT, 'report.md'),
		sections.join('\n\n') + '\n',
	);
	console.log(`\n${sections.join('\n\n')}\n\nWritten to ${perf.OUT}/report.md`);
	jsonl.end(() => app.quit());
});
