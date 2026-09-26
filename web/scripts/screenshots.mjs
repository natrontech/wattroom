// Marketing screenshots of the real app: `make screenshots`.
//
// Needs the dev pair already running in this checkout — `make infra`, then
// `make dev-server` and `make dev-web` — and drives it at
// http://localhost:$WATTROOM_DEV_WEB_PORT with Playwright: five dev-login
// riders in their own browser contexts. Everything on screen is real. A crew,
// its channels and its chat are seeded through the API, Luca's playlist is
// synthesized with ffmpeg and uploaded to the library, the riders pedal
// simulated trainers, and the session, the sprint and the summary are the
// hub's own. Idempotent: a rerun reuses the crew, the riders and the tracks.
// A run takes about seven minutes, most of it the session riding.
//
// Writes web/static/screens/<name>.webp (dark theme, 2x, 1280x800 CSS px
// unless noted; cwebp or ImageMagick encodes):
//   session         Mara's view of a live four-rider session, mid-interval
//   sprint          the same session during a sprint's all-out window
//   summary         the session summary each rider gets when it ends
//   game-modes      the start dialog's Games tab: every mode and its rule
//   crew            a crew's text channel, the live session in the sidebar
//   jukebox         the voice channel's deck and queue, cropped to the panel
//   workout-editor  the workout editor with the interval graph
//   phone           375x812 touch, no Web Bluetooth: the session, spectated
//
// Nothing is heard: the browser runs with --mute-audio and every context
// zeroes the mixer before a page mounts. The deck plays synthesized beats,
// never a real song, and YouTube's player hosts are blocked outright.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.WATTROOM_DEV_WEB_PORT;
if (!PORT) {
	console.error(
		'WATTROOM_DEV_WEB_PORT is unset — run through `make screenshots`.',
	);
	process.exit(1);
}
const BASE = `http://localhost:${PORT}`;
const OUT = fileURLToPath(new URL('../static/screens/', import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'wattroom-screens-'));

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 812 };

const CREW = 'Tuesday Pain Cave';
/** The crew's second text and voice channel, beside the Lounge it opens with. */
const TEXT_CHANNELS = ['Race Plans'];
const VOICE_CHANNELS = ['Sunday Long Ride'];
/** Riders: the host, three who ride with her, and one watching from a phone. */
const HOST = { name: 'Mara', ftp: 265, kg: 61 };
const RIDERS = [
	{ name: 'Ines', ftp: 230, kg: 58 },
	{ name: 'Luca', ftp: 310, kg: 74 },
	{ name: 'Sam', ftp: 215, kg: 70 },
];
const WATCHER = { name: 'Noor', ftp: 240, kg: 66 };

/**
 * The session's workout: a short warm-up so the shot lands in an interval
 * within two minutes rather than the library's ten. Fractions of FTP, the
 * shape docs/SPEC.md's workout JSON takes.
 */
const WORKOUT = {
	name: 'Tuesday Over-Unders',
	author: HOST.name,
	steps: [
		{ type: 'warmup', seconds: 60, from: 0.5, to: 0.75 },
		{
			type: 'repeat',
			times: 3,
			steps: [
				{
					type: 'repeat',
					times: 3,
					steps: [
						{ type: 'steady', seconds: 90, target: 0.9 },
						{ type: 'steady', seconds: 45, target: 1.05 },
					],
				},
				{ type: 'steady', seconds: 240, target: 0.55 },
			],
		},
		{ type: 'cooldown', seconds: 300, from: 0.6, to: 0.4 },
	],
};

/** The Lounge's backlog. Noor speaks last, so her view has read it all. */
const CHAT = [
	['Mara', 'Over-unders tonight at seven. Who is in?'],
	['Ines', 'In. Legs still remember Sunday though'],
	['Luca', 'In, and I am bringing the playlist'],
	['Sam', 'Trainer is calibrated. See you on the start line'],
	[
		'Mara',
		'Short warm-up, then straight into it. Sprints whenever I feel like it',
	],
	['Noor', 'Cannot ride tonight. I will watch from the sofa and heckle'],
];
/** Reactions on the backlog: [who, line index, emoji]. */
const REACTIONS = [
	['Ines', 0, '\u{1F525}'],
	['Sam', 0, '\u{1F525}'],
	['Luca', 4, '\u{1F480}'],
	['Mara', 5, '\u{1F602}'],
	['Sam', 5, '\u{1F602}'],
];

/**
 * Luca's playlist: invented titles over a synthesized beat, made by ffmpeg
 * and uploaded to the self-hosted library — no real song, no YouTube.
 * Deterministic bytes, so a rerun dedupes to the same rows.
 */
const TRACKS = [
	{
		title: 'Threshold Nights',
		artist: 'The Cadence Club',
		bpm: 128,
		seconds: 214,
	},
	{
		title: 'Big Ring Boulevard',
		artist: 'Midnight Watts',
		bpm: 124,
		seconds: 187,
	},
	{ title: 'Ninety RPM', artist: 'The Cadence Club', bpm: 132, seconds: 201 },
	{
		title: 'Sweet Spot Sunrise',
		artist: 'Lactate Lane',
		bpm: 118,
		seconds: 176,
	},
];

/** docs/SPEC.md's session lifecycle: a 10 s countdown before the timeline. */
const COUNTDOWN_MS = 10_000;

const browser = await chromium.launch({ args: ['--mute-audio'] });
const contexts = [];

try {
	await main();
} finally {
	for (const context of contexts) await context.close().catch(() => {});
	await browser.close();
	rmSync(TMP, { recursive: true, force: true });
}

async function main() {
	const host = await rider(HOST);
	const riders = [];
	for (const r of RIDERS) riders.push(await rider(r));
	const [ines, luca] = riders;
	// Noor twice: at her desk, and on the sofa with her phone.
	const desk = await rider(WATCHER);
	const sofa = await rider(WATCHER, PHONE);

	const world = await seed(host, [...riders, desk]);

	// --- the editor, while nobody is riding yet --------------------------------
	await host.page.goto(`/workouts/edit?w=${world.workout}`);
	await host.page.getByLabel('Workout name').waitFor();
	await shoot(host.page, 'workout-editor');

	// --- a live session, music on the deck ---------------------------------------
	const everyone = [host, ...riders];
	for (const r of everyone) {
		await r.page.goto(`${world.voicePath}/training`);
		await r.page
			.getByRole('button', { name: 'Ride simulated' })
			.click({ timeout: 30_000 });
	}
	const music = await queueMusic(luca, world.voice);
	const picker = await openPicker(host, 'Workouts');
	await picker
		.getByRole('textbox', { name: 'find a workout' })
		.fill(WORKOUT.name);
	await picker
		.getByRole('button', { name: new RegExp(WORKOUT.name) })
		.first()
		.click();
	await picker.getByRole('button', { name: `Start ${WORKOUT.name}` }).click();
	const started = Date.now() + COUNTDOWN_MS;
	// A session leaves everyone else alone until they join (ADR-0059).
	for (const r of riders)
		await r.page
			.getByRole('link', { name: 'Join the ride' })
			.click({ timeout: COUNTDOWN_MS + 20_000 });
	await host.page.waitForURL('**/s/**');
	const sessionPath = new URL(host.page.url()).pathname;

	// The warm-up drawn behind, the first "over" under way.
	await until(started, 60 + 90 + 20);
	await shoot(host.page, 'session');

	// Noor on the sofa: a phone spectates (WATTROOM.md, ADR-0058).
	await sofa.page.goto(sessionPath);
	await sofa.page.getByText(/^watching /i).waitFor({ timeout: 30_000 });
	await shoot(sofa.page, 'phone');

	// The crew from Noor's desk, the session live under its voice channel.
	await desk.page.goto(world.textPath);
	await desk.page.getByText(CHAT.at(-1)[1]).waitFor();
	await shoot(desk.page, 'crew');

	// The deck on its own: the panel widened and the window tall enough that
	// the deck's 45 % cap holds the queue under it too.
	if (music) {
		await desk.page.setViewportSize({ width: DESKTOP.width, height: 2000 });
		await desk.page.evaluate(() =>
			localStorage.setItem('wattroom.pane.side-panel', '{"w":400}'),
		);
		await desk.page.goto(world.voicePath);
		const deck = desk.page
			.locator('section')
			.filter({ has: desk.page.locator('.eyebrow', { hasText: /^jukebox$/ }) });
		await deck.getByText(TRACKS[0].title).first().waitFor();
		await deck.getByText('in sync').waitFor({ timeout: 30_000 });
		await shoot(desk.page, 'jukebox', deck);
	}

	// --- a sprint ---------------------------------------------------------------
	await host.page.getByRole('button', { name: 'arm a sprint' }).click();
	await host.page.getByText('all out').waitFor({ timeout: 20_000 });
	await host.page.waitForTimeout(6_000);
	await shoot(host.page, 'sprint');

	// --- the summary: five minutes in, so the power curve has a 5 min best -----
	await until(started, 5 * 60 + 20);
	await host.page.getByRole('button', { name: 'end the session' }).click();
	await host.page
		.getByRole('dialog')
		.getByRole('button', { name: 'End the session' })
		.click();
	for (const r of everyone)
		await r.page
			.getByRole('dialog', { name: 'Session summary' })
			.waitFor({ timeout: 30_000 });
	await shoot(ines.page, 'summary');
	for (const r of everyone)
		await r.page
			.getByRole('dialog', { name: 'Session summary' })
			.getByRole('button', { name: /^Back to/ })
			.click();

	// --- the game modes: the start dialog's other tab ------------------------------
	const games = await openPicker(host, 'Games');
	await games.getByRole('button', { name: 'Start game' }).first().waitFor();
	await shoot(host.page, 'game-modes');
}

/** The host's start dialog, open on one of its tabs. */
async function openPicker(host, tab) {
	await host.page
		.getByRole('button', { name: 'Start a session' })
		.click({ timeout: 30_000 });
	const picker = host.page.getByRole('dialog', { name: 'Start a session' });
	await picker.getByRole('button', { name: tab }).click();
	return picker;
}

/** Wait until the session has run this many seconds. */
async function until(started, seconds) {
	const left = started + seconds * 1000 - Date.now();
	if (left > 0) await new Promise((wait) => setTimeout(wait, left));
}

/**
 * Luca's tracks on the voice channel's deck. Skipped — and so is the
 * jukebox shot — where ffmpeg is not installed to make them.
 */
async function queueMusic(uploader, voice) {
	const ids = [];
	for (const track of TRACKS) {
		const mp3 = synthesize(track);
		if (!mp3) {
			console.warn(
				'ffmpeg is not installed: no music on the deck, no jukebox.webp',
			);
			return false;
		}
		const res = await uploader.page.request.post(
			`/api/tracks?name=${encodeURIComponent(track.title)}`,
			{ data: readFileSync(mp3), headers: { 'content-type': 'audio/mpeg' } },
		);
		if (!res.ok())
			throw new Error(
				`uploading ${track.title}: ${res.status()} ${await res.text()}`,
			);
		ids.push((await res.json()).id);
	}
	// The hub keeps a deck while it runs: a rerun queues only what is missing.
	const onDeck = await deckTracks(uploader, voice);
	const missing = ids.filter((id) => !onDeck.includes(id));
	if (missing.length > 0)
		await must(
			api(uploader.page, 'POST', `/api/channels/${voice}/queue`, {
				trackIds: missing,
			}),
			'queueing the playlist',
		);
	return true;
}

/** The library tracks a voice channel's deck holds, read off its first tick. */
function deckTracks(member, voice) {
	return member.page.evaluate(async (voice) => {
		const socket = new WebSocket(`ws://${location.host}/ws/channels/${voice}`);
		const deck = await new Promise((resolve) => {
			// A deck that has never held anything rides no tick at all.
			const empty = setTimeout(() => resolve(null), 5_000);
			socket.onmessage = (event) => {
				const jukebox = JSON.parse(event.data).tick?.jukebox;
				if (!jukebox) return;
				clearTimeout(empty);
				resolve(jukebox);
			};
		});
		socket.close();
		if (!deck) return [];
		return [deck.current, ...deck.queue]
			.map((entry) => entry?.trackId)
			.filter(Boolean);
	}, voice);
}

/** A beat at the track's tempo with a slow swell — enough for a waveform worth drawing. */
function synthesize({ title, artist, bpm, seconds }) {
	const beat = 60 / bpm;
	const expr = [
		`0.7*sin(2*PI*52*t)*exp(-9*mod(t,${beat}))`,
		`0.3*sin(2*PI*110*t)*lt(mod(t,${beat}),${beat / 2})`,
		`0.12*sin(2*PI*880*t)*exp(-40*mod(t+${beat / 2},${beat}))`,
	].join('+');
	const swell = `(0.55+0.45*sin(2*PI*t/41))*(0.85+0.15*sin(2*PI*t/9))`;
	const out = join(TMP, `${title}.mp3`);
	try {
		execFileSync(
			'ffmpeg',
			[
				...['-nostdin', '-hide_banner', '-loglevel', 'error', '-y'],
				...['-f', 'lavfi', '-i', `aevalsrc='(${expr})*${swell}':s=22050`],
				...['-t', String(seconds), '-ac', '1', '-c:a', 'libmp3lame'],
				...['-b:a', '48k', '-fflags', '+bitexact'],
				...['-metadata', `title=${title}`, '-metadata', `artist=${artist}`],
				...['-metadata', `TBPM=${bpm}`],
				out,
			],
			{ stdio: ['ignore', 'inherit', 'inherit'] },
		);
	} catch (err) {
		if (err.code === 'ENOENT') return null;
		throw err;
	}
	return out;
}

/** A signed-in rider in a context of its own, muted and dark before anything mounts. */
async function rider(who, viewport = DESKTOP) {
	const phone = viewport === PHONE;
	const context = await browser.newContext({
		baseURL: BASE,
		viewport,
		isMobile: phone,
		hasTouch: phone,
		deviceScaleFactor: 2,
		colorScheme: 'dark',
		// Pinned, so dates and times read the same on every machine.
		locale: 'en-GB',
		timezoneId: 'Europe/Zurich',
	});
	contexts.push(context);
	await context.addInitScript(() => {
		// Mute before you play (AGENTS.md): all four channels in one object,
		// because what is stored replaces what was there.
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		);
		localStorage.setItem('wattroom.theme.v1', 'dark');
	});
	// The player itself never loads, so nothing can start playing.
	await context.route(
		/^https:\/\/([a-z0-9-]+\.)*(youtube(-nocookie)?\.com)\//,
		(route) => route.abort(),
	);
	if (phone)
		// An iPhone has no Web Bluetooth: it watches a session rather than
		// rides one ($lib/device.svelte.ts reads all three signals).
		await context.addInitScript(() =>
			Object.defineProperty(Navigator.prototype, 'bluetooth', {
				get: () => undefined,
				configurable: true,
			}),
		);
	const page = await context.newPage();
	await page.goto(`/api/auth/dev/start?as=${encodeURIComponent(who.name)}`);
	const me = await api(page, 'GET', '/api/me');
	if (me.json?.displayName !== who.name)
		throw new Error(
			`dev sign-in as ${who.name} failed — is WATTROOM_DEV_LOGIN set on the server?`,
		);
	await must(
		api(page, 'PATCH', '/api/me', {
			displayName: who.name,
			ftpWatts: who.ftp,
			weightKg: who.kg,
		}),
		`${who.name}'s FTP and weight`,
	);
	return { ...who, page };
}

/** The crew, its channels, its chat and the host's workout — made once, reused after. */
async function seed(host, members) {
	const mine = await api(host.page, 'GET', '/api/crews');
	let crew = mine.json.crews.find((c) => c.name === CREW);
	if (!crew)
		crew = (
			await must(
				api(host.page, 'POST', '/api/crews', { name: CREW }),
				'founding the crew',
			)
		).json;
	const { code } = (await api(host.page, 'GET', `/api/crews/${crew.id}`)).json;
	for (const m of members) {
		const theirs = await api(m.page, 'GET', '/api/crews');
		if (!theirs.json.crews.some((c) => c.id === crew.id))
			await must(
				api(m.page, 'POST', '/api/crews/join', { code }),
				`${m.name} joining`,
			);
	}

	const list = async () =>
		(await api(host.page, 'GET', `/api/crews/${crew.id}/channels`)).json
			.channels;
	let channels = await list();
	for (const [kind, names] of [
		['text', TEXT_CHANNELS],
		['voice', VOICE_CHANNELS],
	])
		for (const name of names)
			if (!channels.some((c) => c.kind === kind && c.name === name))
				await must(
					api(host.page, 'POST', `/api/crews/${crew.id}/channels`, {
						kind,
						name,
					}),
					`opening ${name}`,
				);
	channels = await list();
	const text = channels.find((c) => c.kind === 'text' && c.name === 'Lounge');
	const voice = channels.find((c) => c.kind === 'voice' && c.name === 'Lounge');

	const said = await api(host.page, 'GET', `/api/channels/${text.id}/chat`);
	if (said.json.messages.length === 0) {
		const byName = Object.fromEntries(
			[host, ...members].map((m) => [m.name, m]),
		);
		const posted = [];
		for (const [from, line] of CHAT)
			posted.push(
				(
					await must(
						api(byName[from].page, 'POST', `/api/channels/${text.id}/chat`, {
							text: line,
						}),
						`${from}'s line`,
					)
				).json.id,
			);
		for (const [from, line, emoji] of REACTIONS)
			await must(
				api(
					byName[from].page,
					'POST',
					`/api/channels/${text.id}/chat/reactions`,
					{ messageId: posted[line], emoji },
				),
				`${from}'s reaction`,
			);
	}

	const saved = await api(host.page, 'GET', '/api/workouts');
	let workout = saved.json.workouts.find(
		(w) => w.workout.name === WORKOUT.name,
	);
	if (!workout)
		workout = (
			await must(
				api(host.page, 'POST', '/api/workouts', { workout: WORKOUT }),
				'saving the workout',
			)
		).json;

	// A session a cut-short run left behind would hold the channel.
	await endSessions(host, crew.id);

	return {
		crew: crew.id,
		workout: workout.id,
		voice: voice.id,
		voicePath: `/crew/${crew.id}/v/${voice.id}`,
		textPath: `/crew/${crew.id}/c/${text.id}`,
	};
}

/** End whatever runs in the crew's voice channels, as the owner may. */
async function endSessions(owner, crew) {
	const { sessions } = (await api(owner.page, 'GET', `/api/crews/${crew}/live`))
		.json;
	for (const { channel } of sessions)
		await owner.page.evaluate(async (channel) => {
			const socket = new WebSocket(
				`ws://${location.host}/ws/channels/${channel}`,
			);
			await new Promise((open, fail) => {
				socket.onopen = open;
				socket.onerror = fail;
			});
			socket.send(JSON.stringify({ control: { action: 'end' } }));
			await new Promise((wait) => setTimeout(wait, 1_000));
			socket.close();
		}, channel);
	for (let tries = 0; tries < 20; tries++) {
		const live = await api(owner.page, 'GET', `/api/crews/${crew}/live`);
		if (live.json.sessions.length === 0) return;
		await owner.page.waitForTimeout(500);
	}
	throw new Error('a session left running in the crew would not end');
}

/** One API call from inside a signed-in page, so its session cookie rides along. */
function api(page, method, path, body) {
	return page.evaluate(
		async ({ method, path, body }) => {
			const res = await fetch(path, {
				method,
				headers: body ? { 'content-type': 'application/json' } : {},
				body: body ? JSON.stringify(body) : undefined,
			});
			const text = await res.text();
			let json = null;
			try {
				json = JSON.parse(text);
			} catch {
				/* not JSON: an empty 204, say */
			}
			return { status: res.status, json };
		},
		{ method, path, body },
	);
}

async function must(call, what) {
	const res = await call;
	if (res.status >= 400)
		throw new Error(`${what}: ${res.status} ${JSON.stringify(res.json)}`);
	return res;
}

/**
 * A PNG from Playwright, written out as WebP: fonts in, entrances finished,
 * and no focus ring on whichever field the page focused for typing.
 */
async function shoot(page, name, region) {
	await page.evaluate(async () => {
		await document.fonts.ready;
		if (document.activeElement instanceof HTMLElement)
			document.activeElement.blur();
	});
	await page.waitForTimeout(1_500);
	const png = join(TMP, `${name}.png`);
	await page.screenshot({ path: png, clip: region && (await margin(region)) });
	const webp = join(OUT, `${name}.webp`);
	toWebp(png, webp);
	console.log(`${name}.webp  ${Math.round(statSync(webp).size / 1024)} KB`);
}

/** A locator's box with some of the page around it, so a panel does not sit on its edge. */
async function margin(locator, pad = 16) {
	const box = await locator.boundingBox();
	return {
		x: box.x - pad,
		y: box.y - pad,
		width: box.width + 2 * pad,
		height: box.height + 2 * pad,
	};
}

function toWebp(png, webp) {
	for (const [cmd, args] of [
		['cwebp', ['-quiet', '-q', '80', '-m', '6', png, '-o', webp]],
		['magick', [png, '-quality', '80', webp]],
	]) {
		try {
			execFileSync(cmd, args, { stdio: 'inherit' });
			return;
		} catch (err) {
			if (err.code !== 'ENOENT') throw err;
		}
	}
	throw new Error(
		'Neither cwebp nor ImageMagick is installed — `brew install webp`.',
	);
}
