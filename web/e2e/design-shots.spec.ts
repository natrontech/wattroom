import { test, type WebSocketRoute } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	ROADS,
	bigWatts,
	designCrew,
	fixtureRoad,
	joinCrew,
	newestRide,
	planTwo,
	readRoad,
	savedRide,
	voicePath,
} from './design/seed';
import {
	endSession,
	joinSession,
	startSession,
	toTraining,
} from './design/session';
import {
	DESK,
	DESK_720,
	HUD_SHELL,
	OUT,
	PHONE,
	RIDE_SECOND,
	Shoot,
	TV,
	assertRiding,
	atSecond,
	ride,
	wanted,
	type Opened,
} from './design/shoot';

/**
 * The design shots (#3666, docs/design/DESIGN-CHECK.md): every surface in
 * docs/design/TARGETS.md whose route exists today, shot the way its section's
 * Capture line says, with the probes beside each image. `make design-shots`
 * runs it against this checkout's dev pair; without DESIGN_SHOTS_OUT it skips.
 *
 * It rides as the dev rider Designer and seeds what it needs through the API
 * — roads, rides, a crew — reusing what an earlier run left. The mixer is
 * zeroed in every context and the browser is muted. LiveKit is shared: the
 * session surfaces join a voice channel on it.
 *
 * A surface whose route is still to come is a `test.fixme` naming the issue
 * that brings it, so it shows in the list and its issue turns it on.
 */

test.skip(!OUT, 'the design shots run through `make design-shots`');

/** One test per surface id; `take` gets a Shoot that cleans up after it. */
function surface(id: string, take: (s: Shoot) => Promise<void>) {
	test(id, async ({ browser }) => {
		test.skip(!wanted(id), 'not in DESIGN_SHOTS_SURFACES');
		const s = new Shoot(browser, id);
		await s.clean();
		try {
			await take(s);
		} catch (error) {
			await s.failed(error);
			throw error;
		} finally {
			await s.close();
		}
	});
}

/** A page shot whole, after it has settled. */
async function page(
	s: Shoot,
	opened: Opened,
	path: string,
	{ name, settle = 2500 }: { name?: string; settle?: number } = {},
) {
	await opened.page.goto(path);
	await opened.page.waitForTimeout(settle);
	await s.shot(opened, { name, full: true });
}

// ─── A. Riding surfaces ──────────────────────────────────────────────────

surface('ride-road-world', async (s) => {
	for (const [device, name] of [
		[DESK, 'ride-road-world'],
		[TV, 'ride-road-world-tv'],
	] as const) {
		const o = await s.open(device, { world: true });
		const road = await fixtureRoad(o.page, 'hairpin');
		await ride(o.page, `/ride?w=openers&road=${road}&from=0`);
		await assertRiding(o.page, true);
		await s.shot(o, { name });
	}
});

surface('ride-workout-world', async (s) => {
	// A negative check: no road, so no world (G9). Recorded, not asserted —
	// the probe's world.mounted is item 1's answer, and a world that mounts
	// here is the defect the shot exists to show.
	const o = await s.open(DESK, { world: true });
	await ride(o.page, '/ride?w=openers');
	await assertRiding(o.page);
	await s.shot(o);
});

surface('ride-workout-flat', async (s) => {
	const o = await s.open(DESK, { world: false });
	await ride(o.page, '/ride?w=openers');
	await assertRiding(o.page);
	await s.shot(o);
	// Four digits: a workout asking 1,100 W, which the simulated trainer holds.
	const big = await s.open(DESK, { world: false });
	await ride(big.page, `/ride?w=${await bigWatts(big.page)}`);
	await assertRiding(big.page);
	await s.shot(big, { name: 'ride-workout-flat-1000w' });
});

/**
 * The trainer falls silent past SIGNAL_LOST_MS: a replay the spec serves
 * itself, twenty seconds long, after which the simulated trainer sends
 * nothing (simulated.ts, #54) — on the flat ride and on the world's.
 */
const SILENCE = {
	samples: Array.from({ length: 20 }, () => ({ watts: 200, cadence: 88 })),
};

surface('ride-status', async (s) => {
	for (const [name, world, road] of [
		['ride-status', false, false],
		['ride-status-road-world', true, true],
	] as const) {
		const o = await s.open(DESK, { world });
		await o.page.route('**/fixtures/design-silence.json', (route) =>
			route.fulfill({ json: SILENCE }),
		);
		const on = road
			? `&road=${await fixtureRoad(o.page, 'hairpin')}&from=0`
			: '';
		await o.page.goto(`/ride?w=openers${on}&replay=design-silence`);
		// The replay starts the ride itself.
		await o.page.getByTestId('ride-replay').click({ timeout: 15_000 });
		// Twenty samples, SIGNAL_LOST_MS, and the line settling.
		await o.page.waitForTimeout(30_000);
		await s.shot(o, { name });
	}
});

surface('ride-skyline-fallback', async (s) => {
	// Forced onto the Skyline as the rider sets it on this device, then again
	// under reduced motion.
	for (const [name, reducedMotion, flat] of [
		['ride-skyline-fallback', undefined, true],
		['ride-skyline-fallback-reduced', 'reduce', false],
	] as const) {
		const o = await s.open(DESK, { world: true, reducedMotion });
		if (flat)
			await o.ctx.addInitScript(() =>
				localStorage.setItem('wattroom.flat-road.v1', '1'),
			);
		const road = await fixtureRoad(o.page, 'hairpin');
		await ride(o.page, `/ride?road=${road}`);
		await assertRiding(o.page);
		await s.shot(o, { name });
	}
});

surface('ride-countin', async (s) => {
	const o = await s.open(DESK, { world: true });
	const road = await fixtureRoad(o.page, 'hairpin');
	await o.page.goto(`/ride?w=openers&road=${road}`);
	await o.page
		.getByRole('button', { name: 'Ride simulated' })
		.first()
		.click({ timeout: 15_000 });
	await o.page
		.getByRole('button', { name: /^Start (riding|the ride)$/ })
		.first()
		.click();
	await o.page.waitForTimeout(1000);
	await s.shot(o);
});

surface('ride-free-road', async (s) => {
	// World off, with the OS set to light: the cave has to hold anyway (G1).
	const o = await s.open({ ...DESK, colorScheme: 'light' }, { world: false });
	const road = await fixtureRoad(o.page, 'hairpin');
	await ride(o.page, `/ride?road=${road}`);
	await assertRiding(o.page);
	await s.shot(o);
});

test.fixme('ride-free-road-world', () => {
	// The world on a free ride's road is #3663's.
});

test.fixme('ride-free-road-ghost', () => {
	// Added by the ghost issue (#3245), with its seeded effort.
});

surface('ride-tv', async (s) => {
	const o = await s.open(TV, { world: true });
	await ride(o.page, '/ride?w=openers');
	await o.page.getByRole('button', { name: 'TV', exact: true }).first().click();
	await o.page.waitForTimeout(3000);
	await assertRiding(o.page);
	await s.shot(o);
});

surface('phone-ride', async (s) => {
	const o = await s.open(PHONE, { world: true });
	await ride(o.page, '/ride?w=openers');
	await assertRiding(o.page);
	await s.shot(o);
});

test.fixme('phone-ride-road', () => {
	// The world on a free ride's road is #3663's.
});

surface('hud', async (s) => {
	// /hud beside a road free ride: the desktop shell's 320 × 132 window, and
	// ADR-0041's second-screen tab.
	const o = await s.open(DESK, { world: false });
	const road = await fixtureRoad(o.page, 'hairpin');
	await ride(o.page, `/ride?road=${road}`, { second: 8 });
	await assertRiding(o.page);
	for (const [name, size] of [
		['hud-shell', HUD_SHELL],
		['hud', DESK.viewport!],
	] as const) {
		const hud = await o.ctx.newPage();
		const errors: string[] = [];
		hud.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
		await hud.setViewportSize(size);
		await hud.goto('/hud');
		await hud.waitForTimeout(4000);
		await s.shot({ page: hud, errors }, { name });
		await hud.close();
	}
});

surface('ride-preride', async (s) => {
	// With a remembered road (Designer has ridden one), and without (a rider
	// who never has).
	const known = await s.open(DESK, { world: false });
	await fixtureRoad(known.page, 'hairpin');
	await page(s, known, '/ride', { name: 'ride-preride' });
	const fresh = await s.open(DESK, { as: 'Newcomer', world: false });
	await page(s, fresh, '/ride', { name: 'ride-preride-no-road' });
});

surface('ride-roadpick', async (s) => {
	// The road picker, with both roads seeded. Today it opens from a free
	// ride's “Ride a road”; design/ride-preride (#3671) moves it to /ride's
	// “Change”.
	const o = await s.open(DESK, { world: false });
	await fixtureRoad(o.page, 'hairpin');
	await fixtureRoad(o.page, 'rolling');
	// Before a trainer pairs: the channel's free ride starts itself on
	// pairing, and a started ride closes the picker.
	await o.page.goto(`${voicePath(await designCrew(o.page))}/training`);
	await o.page.getByRole('button', { name: 'Ride a road' }).first().click();
	await o.page.waitForTimeout(1500);
	await s.shot(o, { full: true });
});

/** Designer coaching, Design Partner riding along, a session started. */
async function session(
	s: Shoot,
	pick: Parameters<typeof startSession>[1],
	world: boolean,
) {
	const coach = await s.open(DESK, { world });
	const crew = await designCrew(coach.page);
	if ('road' in pick) await fixtureRoad(coach.page, 'hairpin');
	const rider = await s.open(DESK, { as: 'Design Partner', world });
	await joinCrew(rider.page, crew.code);
	await toTraining(coach.page, crew);
	// A run that failed mid-session left it running: end it first.
	if (
		await coach.page.getByRole('button', { name: 'end the session' }).count()
	) {
		await endSession(coach.page);
		await toTraining(coach.page, crew);
	}
	await toTraining(rider.page, crew);
	await startSession(coach.page, pick);
	await joinSession(rider.page);
	await atSecond(coach.page, RIDE_SECOND);
	return { coach, crew };
}

surface('ride-session-flat', async (s) => {
	// Past the minute it ends to its summary: closing-card-session. While it
	// runs, a third member watches: on the desk the voice channel is the
	// Watch view; a phone opens it from “Watch the session”.
	const { coach, crew } = await session(s, { workout: 'Recovery Spin' }, false);
	try {
		await assertRiding(coach.page);
		await s.shot(coach);
		for (const [device, name] of [
			[DESK, 'ride-watch'],
			[PHONE, 'ride-watch-phone'],
		] as const) {
			const watcher = await s.open(device, { as: 'Design Watcher' });
			await joinCrew(watcher.page, crew.code);
			await watcher.page.goto(voicePath(crew));
			const watch = watcher.page.getByRole('link', {
				name: 'Watch the session',
			});
			if (await watch.isVisible({ timeout: 5000 }).catch(() => false))
				await watch.click();
			await watcher.page.waitForTimeout(3000);
			await s.shot(watcher, { name });
		}
		await atSecond(coach.page, 70);
	} finally {
		await endSession(coach.page);
	}
	await coach.page
		.getByRole('dialog', { name: 'Session summary' })
		.waitFor({ timeout: 30_000 });
	await coach.page.waitForTimeout(1500);
	await s.shot(coach, { name: 'closing-card-session' });
});

surface('ride-session-road', async (s) => {
	const { coach } = await session(s, { road: ROADS.hairpin.name }, true);
	try {
		await assertRiding(coach.page, true);
		await s.shot(coach);
	} finally {
		await endSession(coach.page);
	}
});

surface('ride-race', async (s) => {
	// Designer and Design Partner race the hairpin road (#3174). No screen
	// starts a race yet, so Designer's socket sends the start the hub takes.
	const coach = await s.open(DESK, { world: false });
	const crew = await designCrew(coach.page);
	const road = await fixtureRoad(coach.page, 'hairpin');
	const rider = await s.open(DESK, { as: 'Design Partner', world: false });
	await joinCrew(rider.page, crew.code);
	let socket: WebSocketRoute | undefined;
	await coach.page.routeWebSocket(/\/ws\/channels\//, (ws) => {
		socket = ws.connectToServer();
	});
	await toTraining(coach.page, crew);
	// A run that failed mid-race left it running: end it first.
	if (
		await coach.page.getByRole('button', { name: 'end the session' }).count()
	) {
		await endSession(coach.page);
		await toTraining(coach.page, crew);
	}
	await toTraining(rider.page, crew);
	// Sent until the session opens: a page that reconnected has a new socket.
	const start = JSON.stringify({
		control: { action: 'game', gameMode: 'race', route: { id: road } },
	});
	const open = coach.page.getByRole('button', { name: 'end the session' });
	for (let k = 0; k < 5 && !(await open.count()); k++) {
		socket?.send(start);
		await open.waitFor({ timeout: 4000 }).catch(() => {});
	}
	await joinSession(rider.page);
	await coach.page
		.getByRole('link', { name: 'Go to the ride' })
		.click({ timeout: 15_000 });
	try {
		await coach.page.getByTestId('race-radio').waitFor({ timeout: 40_000 });
		await coach.page
			.getByRole('button', { name: 'RACE page', exact: true })
			.click();
		// Through the 3-minute neutral zone to km 0, then 20 s of racing.
		await coach.page.waitForFunction(
			() =>
				/[+−]\d+:\d\d/.test(
					document.querySelector('[data-field="par"]')?.textContent ?? '',
				),
			null,
			{ timeout: 240_000 },
		);
		await coach.page.waitForTimeout(20_000);
		await s.shot(coach);
	} finally {
		await endSession(coach.page);
	}
});

surface('ride-channel-free', async (s) => {
	// The voice channel's free ride starts itself once the trainer pairs.
	const o = await s.open(DESK, { world: false });
	const crew = await designCrew(o.page);
	await toTraining(o.page, crew);
	await atSecond(o.page, RIDE_SECOND);
	await assertRiding(o.page);
	await s.shot(o);
	await o.page.getByRole('button', { name: 'End ride' }).click();
});

surface('ride-ramp', async (s) => {
	const o = await s.open(DESK);
	await o.page.goto('/ramp');
	await o.page
		.getByRole('button', { name: 'Ride simulated' })
		.first()
		.click({ timeout: 15_000 });
	await o.page.getByRole('button', { name: 'Start ramp test' }).click();
	await atSecond(o.page, RIDE_SECOND);
	await assertRiding(o.page);
	await s.shot(o);
});

surface('ride-road-end', async (s) => {
	// ride-free-road past its minute, then End ride: the card the road ends on,
	// and what it closes to (closing-card-road).
	const o = await s.open(DESK, { world: false });
	const road = await fixtureRoad(o.page, 'hairpin');
	await ride(o.page, `/ride?road=${road}`, { second: 65 });
	await o.page
		// “Save at km …” while there is somewhere to carry on from (road-end.ts).
		.getByRole('button', { name: /^(End ride|Save at km)/ })
		.first()
		.click();
	await o.page.waitForTimeout(1500);
	await s.shot(o, { full: true });
	const save = o.page.getByRole('button', { name: 'Save the ride' });
	if (await save.count()) await save.first().click();
	await o.page
		.getByRole('link', { name: 'See it in your history' })
		.waitFor({ timeout: 30_000 });
	await s.shot(o, { name: 'closing-card-road', full: true });
});

// ─── B. The world's look ─────────────────────────────────────────────────

surface('dev-world', async (s) => {
	const o = await s.open(DESK);
	await o.page.goto('/dev/world');
	await o.page.waitForTimeout(9000);
	await s.shot(o);
});

/** /dev/world at one still moment (#3672): two loads are one frame, chrome off. */
const MOMENT_M = 11_000;
async function moment(s: Shoot, device: typeof DESK, p: 0 | 1) {
	const o = await s.open(device);
	await o.page.goto(
		`/dev/world?m=${MOMENT_M}&p=${p}&cam=chase&look=bluehour&chrome=0`,
	);
	await o.page.waitForFunction(
		() => !!(window as unknown as { __worldProbe?: unknown }).__worldProbe,
		null,
		{ timeout: 30_000 },
	);
	await o.page.waitForTimeout(2000);
	return o;
}

surface('world-start', async (s) => {
	await s.shot(await moment(s, DESK, 0));
	await s.shot(await moment(s, DESK_720, 0), { name: 'world-start-1280' });
	// multi:world-start-twice — the same moment loaded twice, compared pixel
	// for pixel.
	const frames: Buffer[] = [];
	for (let k = 0; k < 2; k++)
		frames.push(await (await moment(s, DESK, 0)).page.screenshot());
	await writeFile(join(OUT, 'world-start-twice.png'), frames[1]);
	await writeFile(
		join(OUT, 'world-start-twice.json'),
		JSON.stringify({ identical: frames[0].equals(frames[1]) }, null, 2) + '\n',
	);
});

surface('world-end', async (s) => {
	await s.shot(await moment(s, DESK, 1));
	await s.shot(await moment(s, DESK_720, 1), { name: 'world-end-1280' });
});

// ─── C. Roads library ────────────────────────────────────────────────────

surface('workouts', async (s) => {
	for (const [device, name] of [
		[DESK, 'workouts'],
		[PHONE, 'phone-workouts'],
	] as const) {
		const o = await s.open(device);
		await fixtureRoad(o.page, 'hairpin');
		await fixtureRoad(o.page, 'rolling');
		await page(s, o, '/workouts', { name });
	}
});

surface('route', async (s) => {
	for (const [device, prefix] of [
		[DESK, 'route'],
		[PHONE, 'phone-route'],
	] as const)
		for (const road of ['hairpin', 'rolling'] as const) {
			const o = await s.open(device);
			const id = await fixtureRoad(o.page, road);
			await page(s, o, `/workouts/routes/${id}`, {
				name: road === 'hairpin' ? prefix : `${prefix}-${road}`,
			});
		}
});

surface('import', async (s) => {
	for (const [device, suffix] of [
		[DESK, ''],
		[PHONE, '-phone'],
	] as const) {
		const o = await s.open(device);
		await page(s, o, '/workouts/import', { name: `import-idle${suffix}` });
		await readRoad(o.page, 'hairpin');
		await o.page.waitForTimeout(2500);
		await s.shot(o, { name: `import${suffix}`, full: true });
		const before = await routeIds(o.page);
		await o.page.getByRole('button', { name: 'Save to my routes' }).click();
		await o.page.getByText(/is on your routes/).waitFor({ timeout: 15_000 });
		await s.shot(o, { name: `import-saved${suffix}`, full: true });
		// The saved copy goes again, so the shelf keeps only the fixtures.
		for (const id of await routeIds(o.page))
			if (!before.has(id))
				await o.page.evaluate(
					(id) => fetch(`/api/routes/${id}`, { method: 'DELETE' }),
					id,
				);
	}
});

async function routeIds(page: Opened['page']): Promise<Set<string>> {
	const { routes } = (await (await page.request.get('/api/routes')).json()) as {
		routes: { id: string }[];
	};
	return new Set(routes.map((r) => r.id));
}

test.fixme('routes', () => {
	// /workouts/routes is still to come (#3692).
});

// ─── D. After the ride ───────────────────────────────────────────────────

/** A 65 s workout, ridden to its closing card. */
async function rideToTheCard(o: Opened) {
	await ride(o.page, '/ride?w=smoke-test');
	await o.page
		.getByRole('link', { name: 'See your ride' })
		.waitFor({ timeout: 120_000 });
	await o.page.waitForTimeout(1500);
}

surface('closing-card', async (s) => {
	// Flow F2 around it: /ride with the workout → riding → the closing card →
	// See your ride → the ride page wearing the card's header and tiles.
	const o = await s.open(DESK, { world: false });
	await page(s, o, '/ride?w=smoke-test', { name: 'flow-f2-1-preride' });
	await o.page
		.getByRole('button', { name: 'Ride simulated' })
		.first()
		.click({ timeout: 15_000 });
	await o.page.getByRole('button', { name: 'Start the ride' }).click();
	await atSecond(o.page, RIDE_SECOND);
	await s.shot(o, { name: 'flow-f2-2-riding' });
	await o.page
		.getByRole('link', { name: 'See your ride' })
		.waitFor({ timeout: 120_000 });
	await o.page.waitForTimeout(1500);
	await s.shot(o, { full: true });
	await o.page.getByRole('link', { name: 'See your ride' }).click();
	await o.page.waitForURL(/\/history\//);
	await o.page.waitForTimeout(2500);
	await s.shot(o, { name: 'flow-f2-4-ride-page', full: true });
	for (const [device, name, reducedMotion] of [
		[PHONE, 'closing-card-phone', undefined],
		[DESK, 'closing-card-reduced', 'reduce'],
	] as const) {
		const other = await s.open(device, { world: false, reducedMotion });
		await rideToTheCard(other);
		await s.shot(other, { name, full: true });
	}
});

surface('ride-detail', async (s) => {
	for (const [device, suffix] of [
		[DESK, ''],
		[PHONE, '-phone'],
	] as const) {
		const o = await s.open(device);
		const road = await fixtureRoad(o.page, 'hairpin');
		await page(s, o, `/history/${await savedRide(o.page)}`, {
			name: `ride-detail${suffix}`,
		});
		await page(s, o, `/history/${await savedRide(o.page, road)}`, {
			name: `ride-detail-road${suffix}`,
		});
	}
	// A crew session's ride on a road (#3738): the session saves it with its
	// road, so its page draws the road as a solo road ride's does. No world:
	// the session is here for the ride it saves, past the minute one is kept.
	const started = Date.now() - 5_000;
	const { coach } = await session(s, { road: ROADS.hairpin.name }, false);
	try {
		await coach.page.waitForTimeout(70_000);
	} finally {
		await endSession(coach.page);
	}
	await coach.page
		.getByRole('dialog', { name: 'Session summary' })
		.waitFor({ timeout: 30_000 });
	await page(s, coach, `/history/${await newestRide(coach.page, started)}`, {
		name: 'ride-detail-session-road',
	});
});

surface('poster', async (s) => {
	// The share card is an image: the file itself is the shot, and there is
	// no page to probe.
	const o = await s.open(DESK);
	const id = await savedRide(o.page, await fixtureRoad(o.page, 'hairpin'));
	const res = await o.page.request.get(`/api/rides/${id}/card.png`);
	if (!res.ok()) throw new Error(`card.png answered ${res.status()}`);
	await writeFile(join(OUT, 'poster.png'), await res.body());
});

surface('history', async (s) => {
	// With no ride (a rider who never rode), and with one (Designer).
	for (const [device, suffix] of [
		[DESK, ''],
		[PHONE, '-phone'],
	] as const) {
		const fresh = await s.open(device, { as: 'Newcomer' });
		await page(s, fresh, '/history', { name: `history${suffix}` });
		const rode = await s.open(device);
		await savedRide(rode.page);
		await page(s, rode, '/history', { name: `history-rides${suffix}` });
	}
});

test.fixme('collections', () => {
	// The Collections tab comes with design/collections (#3693).
});

// ─── E. Home, settings and the landing page ──────────────────────────────

surface('home', async (s) => {
	// Designer in one crew, with two sessions planned this week.
	for (const [device, name] of [
		[DESK, 'home'],
		[PHONE, 'phone-home'],
	] as const) {
		const o = await s.open(device);
		await planTwo(o.page, await designCrew(o.page));
		await page(s, o, '/home', { name });
	}
});

surface('flow-f3', async (s) => {
	// Flow F3, a first run: a fresh account's Home and its set-up card → /ride
	// → the simulated trainer paired → the first ride → the closing card →
	// Home, with the ride under Recent rides. A new rider every run, named in
	// letters only (the dev door's rule).
	const letters = Date.now()
		.toString(26)
		.replace(/[0-9]/g, (d) => 'klmnopqrst'[Number(d)])
		.slice(-8);
	const o = await s.open(DESK, { as: `First ${letters}`, world: false });
	await page(s, o, '/home', { name: 'flow-f3-1-home' });
	await page(s, o, '/ride?w=smoke-test', { name: 'flow-f3-2-ride' });
	await o.page
		.getByRole('button', { name: 'Ride simulated' })
		.first()
		.click({ timeout: 15_000 });
	await o.page.getByRole('button', { name: 'Start the ride' }).waitFor();
	await s.shot(o, { name: 'flow-f3-3-paired' });
	await o.page.getByRole('button', { name: 'Start the ride' }).click();
	await atSecond(o.page, RIDE_SECOND);
	await s.shot(o, { name: 'flow-f3-4-riding' });
	await o.page
		.getByRole('link', { name: 'See your ride' })
		.waitFor({ timeout: 120_000 });
	await o.page.waitForTimeout(1500);
	await s.shot(o, { name: 'flow-f3-5-closing-card', full: true });
	await page(s, o, '/home', { name: 'flow-f3-6-home' });
});

test.fixme('flow-f1', () => {
	// F1 starts at a route card's Ride, which design/route-row (#3683) adds.
});

surface('appearance', async (s) => {
	for (const [device, suffix] of [
		[DESK, ''],
		[PHONE, '-phone'],
	] as const) {
		const o = await s.open(device);
		await page(s, o, '/settings/appearance', { name: `appearance${suffix}` });
		// The Advanced expander comes with the World control (#3214).
		const advanced = o.page.getByText('Advanced', { exact: true });
		if (await advanced.count()) {
			await advanced.first().click();
			await o.page.waitForTimeout(500);
			await s.shot(o, { name: `appearance-advanced${suffix}`, full: true });
		}
	}
	const reduced = await s.open(DESK, { reducedMotion: 'reduce' });
	await page(s, reduced, '/settings/appearance', {
		name: 'appearance-reduced',
	});
});

surface('landing', async (s) => {
	// Signed out, as a stranger meets it: the landing on the desk and a phone,
	// then the public pages that share its copy.
	for (const [device, name, path] of [
		[DESK, 'landing', '/'],
		[PHONE, 'landing-phone', '/'],
		[DESK, 'landing-de', '/de'],
		[DESK, 'landing-game-modes', '/game-modes'],
		[DESK, 'landing-zwift-alternative', '/zwift-alternative'],
		[DESK, 'landing-smart-trainer-app', '/smart-trainer-app'],
	] as const) {
		const o = await s.open(device, { as: null });
		await page(s, o, path, { name });
	}
});

// ─── F, G. Garage and open rides ─────────────────────────────────────────

for (const id of ['garage-shop', 'garage-locker', 'garage-makers'])
	test.fixme(id, () => {
		// /garage comes with the garage issues (#3694).
	});

test.fixme('open-rides', () => {
	// /open-rides comes with #3307.
});
