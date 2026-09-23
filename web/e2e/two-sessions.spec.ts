import type { Page } from '@playwright/test';
import { expect, test, voicePath, type OpenedChannels } from './crew';

/**
 * Two sessions in one crew, side by side (ADR-0058): a session runs in a
 * voice channel, one per channel, each on its own tick — so a crew in two
 * voice channels rides two workouts at once, and each keeps its own numbers
 * and its own deck.
 *
 * Numbers are the privacy half: "a session's numbers go to its own channel"
 * (#2438) is a property of what crossed the wire, so the ticks each rider's
 * socket received are read as well as the screen. The deck is the other half
 * of the voice channel: one deck per call (decision 2), so a track queued in
 * one channel is never heard in the other.
 *
 * Two riders is the smallest crew that shows it: one per channel. Two riders
 * in ONE session seeing each other is two-riders.spec.ts.
 */

/** This spec's own riders — nobody else's (#2133). */
const A = 'Two Sessions Alpha';
const B = 'Two Sessions Bravo';

/** The people column, where the deck lives, is an xl surface. */
const WIDE = { width: 1440, height: 900 };

/** docs/SPEC.md's session lifecycle: a 10 s countdown before the timeline. */
const COUNTDOWN_MS = 10_000;
/** Slack over a live wait — the browser's timer drift, plus a 1 Hz tick. */
const SETTLE_MS = 20_000;

/**
 * Two video ids that name nothing: YouTube is refused below, so nothing is
 * looked up or played (mute before you play, AGENTS.md), and the deck falls
 * back to the id as its title — which is what the screens are read for.
 */
const TRACK = { one: 'wattroomOne', two: 'wattroomTwo' };

/** Everything a page's voice-channel socket was told while a session ran. */
interface Heard {
	/** The session ids the ticks carried. */
	sessions: Set<string>;
	/** Everyone on the ticks' roster or in their metrics. */
	riders: Set<string>;
	/** The most anyone was pushing, by rider id. */
	peak: Map<string, number>;
	/** Every video the deck held — playing or queued. */
	tracks: Set<string>;
	/** How many session ticks arrived, so a wait can ask for a newer one. */
	ticks: number;
	/** The timeline is past its countdown — the crew strip is drawn. */
	running: boolean;
}

function listen(page: Page): Heard {
	const heard: Heard = {
		sessions: new Set(),
		riders: new Set(),
		peak: new Map(),
		tracks: new Set(),
		ticks: 0,
		running: false,
	};
	page.on('websocket', (ws) => {
		if (!ws.url().includes('/ws/channels/')) return;
		ws.on('framereceived', ({ payload }) => {
			if (typeof payload !== 'string') return;
			const tick = JSON.parse(payload).tick;
			// Session ticks only: a rider's page stood in other channels on
			// its way here, and what it heard there is not a session's.
			if (!tick?.state?.id) return;
			heard.ticks += 1;
			if (tick.state.phase === 'running') heard.running = true;
			heard.sessions.add(tick.state.id);
			const deck = tick.jukebox ?? {};
			for (const entry of [deck.current, ...(deck.queue ?? [])])
				if (entry?.videoId) heard.tracks.add(entry.videoId);
			for (const rider of tick.roster ?? []) heard.riders.add(rider.id);
			for (const [id, metrics] of Object.entries(tick.riders ?? {})) {
				heard.riders.add(id);
				const watts = (metrics as { watts: number }).watts;
				heard.peak.set(id, Math.max(heard.peak.get(id) ?? 0, watts));
			}
		});
	});
	return heard;
}

async function idOf(page: Page): Promise<string> {
	return page.evaluate(() =>
		fetch('/api/me')
			.then((res) => res.json())
			.then((me) => String(me.id ?? '')),
	);
}

/** Pair the simulator and start Recovery Spin in the channel — as any member. */
async function startSession(page: Page, opened: OpenedChannels) {
	await page.goto(`${voicePath(opened)}/training`);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start a session' }).click();
	await page
		.getByRole('textbox', { name: 'find a workout' })
		.fill('Recovery Spin');
	await page
		.getByRole('button', { name: /Recovery Spin/ })
		.first()
		.click();
	await page.getByRole('button', { name: 'Start Recovery Spin' }).click();
	// A running session has its own address (#2450), and the page moves there.
	await page.waitForURL(`/crew/${opened.crew}/s/**`, { timeout: 15_000 });
	return page.url().split('/s/')[1].split(/[/?#]/)[0];
}

test('two voice channels run two sessions, each with its own numbers and its own deck', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const b = await riders(B);
	for (const rider of [a, b]) {
		await rider.setViewportSize(WIDE);
		await rider
			.context()
			.route(
				/^https:\/\/([a-z0-9-]+\.)*(youtube(-nocookie)?\.com|ytimg\.com)\//,
				(route) => route.abort(),
			);
	}

	// Two voice channels in A's crew. A opens the second one first, so the
	// channel A is left standing in is A's own.
	const n = Date.now() % 100000;
	const two = await channels.open(a, `Two Sessions Two ${n}`);
	const one = await channels.open(a, `Two Sessions One ${n}`);
	expect(one.crew, 'both channels belong to the one crew').toBe(two.crew);

	// B comes in through the crew's door and stands in the other channel.
	await channels.enter(b, two);

	const heardByA = listen(a);
	const heardByB = listen(b);
	const [aId, bId] = [await idOf(a), await idOf(b)];

	// --- a session in each, started by whoever is standing there ------------
	const sessionA = await startSession(a, one);
	const sessionB = await startSession(b, two);
	expect(sessionB, 'the two channels share one session').not.toBe(sessionA);

	// Both on their own timelines, past the countdown, and pedalling: each
	// socket has heard its own rider push watts, which is also what makes the
	// absences below mean something — the ticks were arriving, and the other
	// rider was not on them.
	for (const [page, heard, id, name] of [
		[a, heardByA, aId, A],
		[b, heardByB, bId, B],
	] as const) {
		await expect
			.poll(() => heard.running && (heard.peak.get(id) ?? 0) > 0, {
				message: `${name}'s own session never ran with ${name}'s watts on it`,
				timeout: COUNTDOWN_MS + SETTLE_MS,
			})
			.toBe(true);
		// The countdown screen draws no crew strip. Each rider coaches their
		// own session, and the sprint control is there only once the
		// timeline runs — so is the strip.
		await expect(
			page.getByRole('button', { name: 'arm a sprint' }),
		).toBeVisible({
			timeout: SETTLE_MS,
		});
	}

	// --- each channel's numbers stay in it ----------------------------------
	expect([...heardByA.sessions], `${A}'s socket heard another session`).toEqual(
		[sessionA],
	);
	expect([...heardByB.sessions], `${B}'s socket heard another session`).toEqual(
		[sessionB],
	);
	expect(
		[...heardByA.riders],
		`${B} reached ${A}'s session — a session's numbers leave its channel`,
	).toEqual([aId]);
	expect(
		[...heardByB.riders],
		`${A} reached ${B}'s session — a session's numbers leave its channel`,
	).toEqual([bId]);
	// And on screen: the crew strip is everyone else in the session, and in
	// each of these there is nobody else.
	await expect(a.getByTestId('crew-tile')).toHaveCount(0);
	await expect(b.getByTestId('crew-tile')).toHaveCount(0);

	// --- one deck each -------------------------------------------------------
	const queue = async (page: Page, id: string) => {
		await page
			.getByRole('textbox', {
				name: 'add music: search your library, or paste a YouTube link',
			})
			.fill(`https://www.youtube.com/watch?v=${id}`);
		await page.keyboard.press('Enter');
		// The visible copy: the jukebox rail holds the track too, and steps
		// aside on the live channel's own pages (#2460), so its copy is hidden.
		await expect(
			page.getByText(id).filter({ visible: true }).first(),
			`what was queued never reached the deck: ${id}`,
		).toBeVisible({ timeout: SETTLE_MS });
	};
	await queue(a, TRACK.one);
	await queue(b, TRACK.two);
	// Two more ticks on each side since the later add: a shared deck would
	// have carried the other channel's track by now.
	const since = [heardByA.ticks, heardByB.ticks];
	await expect
		.poll(
			() => Math.min(heardByA.ticks - since[0], heardByB.ticks - since[1]),
			{
				message: 'the sessions stopped ticking',
				timeout: SETTLE_MS,
			},
		)
		.toBeGreaterThanOrEqual(2);
	expect(
		[...heardByA.tracks],
		`the deck in ${one.name} carried another channel's track`,
	).toEqual([TRACK.one]);
	expect(
		[...heardByB.tracks],
		`the deck in ${two.name} carried another channel's track`,
	).toEqual([TRACK.two]);
	// And each screen shows its own track and nothing of the other's.
	await expect(
		a.getByText(TRACK.one).filter({ visible: true }).first(),
	).toBeVisible();
	await expect(a.getByText(TRACK.two)).toHaveCount(0);
	await expect(
		b.getByText(TRACK.two).filter({ visible: true }).first(),
	).toBeVisible();
	await expect(b.getByText(TRACK.one)).toHaveCount(0);
});
