import type { Page } from '@playwright/test';
import { unpackRoad } from '../../src/lib/road/road';
import { hairpinGpx, rollingGpx } from '../road-gpx';

/**
 * The design shots' fixtures (#3666), seeded through the API the way a rider
 * seeds them, found again by name, so a second run reuses the first's.
 */

/** The fixture roads, each by the name its owner gives it on import. */
export const ROADS = {
	// Renamed with #3725's geometry, with #3761's key, and with #3680's loop
	// flag, so a road seeded before any of them — the old shape, stored bare,
	// or with no loop sent — is not reused.
	hairpin: { name: 'Design switchbacks', gpx: hairpinGpx, turns: true },
	rolling: { name: 'Design swells', gpx: rollingGpx, turns: false },
} as const;
export type RoadName = keyof typeof ROADS;

type RouteRow = { id: string; name: string };

const routes = async (page: Page): Promise<RouteRow[]> =>
	(await (await page.request.get('/api/routes')).json()).routes ?? [];

/** Loads the importer with a road's file read, as a rider drops it. */
export async function readRoad(page: Page, road: RoadName): Promise<void> {
	await page.goto('/workouts/import');
	await page
		.locator('input[type=file]')
		.first()
		.setInputFiles({
			name: `${road}.gpx`,
			mimeType: 'application/gpx+xml',
			buffer: Buffer.from(ROADS[road].gpx()),
		});
}

/** The road's route id: imported and named on first use. */
export async function fixtureRoad(page: Page, road: RoadName): Promise<string> {
	const before = await routes(page);
	const found = before.find((r) => r.name === ROADS[road].name);
	if (found) return turning(page, road, found.id);
	await readRoad(page, road);
	await page.getByRole('button', { name: 'Save to my routes' }).click();
	await page.getByText(/is on your routes/).waitFor({ timeout: 15_000 });
	const known = new Set(before.map((r) => r.id));
	const made = (await routes(page)).find((r) => !known.has(r.id));
	if (!made) throw new Error(`the ${road} road never reached /api/routes`);
	// Through the page: the server's same-origin check wants its Origin.
	const named = await page.evaluate(
		async ([id, name]) =>
			(
				await fetch(`/api/routes/${id}`, {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ name }),
				})
			).ok,
		[made.id, ROADS[road].name],
	);
	if (!named) throw new Error(`the ${road} road could not be named`);
	return turning(page, road, made.id);
}

/**
 * The route, once its owner's read carries its turns (#3761). A server with
 * no WATTROOM_TOKEN_KEY keeps a road bare — no turns, so no shape — and its
 * world is one straight: every world shot would show a road that is not the
 * fixture's, and pass for it.
 */
async function turning(
	page: Page,
	road: RoadName,
	id: string,
): Promise<string> {
	if (!ROADS[road].turns) return id;
	const read = await page.request.get(`/api/routes/${id}`);
	const packed = ((await read.json()) as { road?: string }).road;
	const turns = packed ? unpackRoad(Buffer.from(packed, 'base64')).turns : [];
	if (!turns.some((t) => t !== 0))
		throw new Error(
			`route ${id} came back with no turns: is WATTROOM_TOKEN_KEY set on this server (make dev-server sets one)?`,
		);
	return id;
}

/** A call from the page, so the server's same-origin check sees its Origin. */
async function call<T = unknown>(
	page: Page,
	method: string,
	path: string,
	json?: unknown,
): Promise<{ status: number; body: T }> {
	return page.evaluate(
		async ([method, path, json]) => {
			const res = await fetch(path, {
				method,
				headers: { 'content-type': 'application/json' },
				body: json === undefined ? undefined : JSON.stringify(json),
			});
			return {
				status: res.status,
				body: await res.json().catch(() => null),
			};
		},
		[method, path, json] as const,
	);
}

export interface DesignCrew {
	crew: string;
	code: string;
	voice: string;
}

/** The crew Designer owns, and its voice channel: founded on first use. */
export async function designCrew(page: Page): Promise<DesignCrew> {
	type Crews = { crews?: { id: string; role?: string; code?: string }[] };
	let crew = (await call<Crews>(page, 'GET', '/api/crews')).body.crews?.find(
		(c) => c.role === 'owner',
	);
	if (!crew) {
		const founded = await call<{ id: string; code: string }>(
			page,
			'POST',
			'/api/crews',
			{ name: 'Designer' },
		);
		if (founded.status !== 201)
			throw new Error(`founding the crew: ${JSON.stringify(founded)}`);
		crew = { id: founded.body.id, code: founded.body.code };
	}
	const code = (
		await call<{ code: string }>(page, 'GET', `/api/crews/${crew.id}`)
	).body.code;
	const { channels } = (
		await call<{ channels: { id: string; kind: string }[] }>(
			page,
			'GET',
			`/api/crews/${crew.id}/channels`,
		)
	).body;
	const voice = channels.find((c) => c.kind === 'voice')?.id;
	if (!voice) throw new Error('the crew has no voice channel');
	return { crew: crew.id, code, voice };
}

export const voicePath = (c: DesignCrew) => `/crew/${c.crew}/v/${c.voice}`;

/** A second rider in the crew, by its code; already in is fine. */
export async function joinCrew(page: Page, code: string): Promise<void> {
	const joined = await call(page, 'POST', '/api/crews/join', { code });
	if (joined.status !== 200 && joined.status !== 409)
		throw new Error(`joining the crew: ${JSON.stringify(joined)}`);
}

/** Two sessions planned this week in the crew's voice channel. */
export async function planTwo(page: Page, c: DesignCrew): Promise<void> {
	const { sessions } = (
		await call<{ sessions: { startsAt: string }[] }>(
			page,
			'GET',
			`/api/crews/${c.crew}/schedule`,
		)
	).body;
	const ahead = sessions.filter((s) => Date.parse(s.startsAt) > Date.now());
	for (let n = ahead.length; n < 2; n++) {
		const name = n ? 'Design tempo' : 'Design openers';
		const planned = await call(page, 'POST', `/api/crews/${c.crew}/schedule`, {
			workoutName: name,
			workoutJson: JSON.stringify({
				name,
				steps: [{ type: 'steady', seconds: 1800, target: 0.75 }],
			}),
			startsAt: new Date(Date.now() + (2 + 2 * n) * 3_600_000).toISOString(),
			channelId: c.voice,
		});
		if (planned.status !== 201)
			throw new Error(`planning a session: ${JSON.stringify(planned)}`);
	}
}

type RideRow = { id: string; workoutName: string };

/**
 * A saved ride of ten minutes: on the hairpin road's approach when `road` is
 * given, so its page and poster draw a road. Found again by its name.
 */
export async function savedRide(page: Page, road?: string): Promise<string> {
	const name = road ? 'Design road ride' : 'Design ride';
	const rows = (await call<{ rides: RideRow[] }>(page, 'GET', '/api/rides'))
		.body.rides;
	const found = rows?.find((r) => r.workoutName === name);
	if (found) return found.id;
	const samples = Array.from({ length: 600 }, (_, i) => ({
		watts: 180 + Math.round(40 * Math.sin(i / 30)),
		cadence: 88,
		hr: 140,
		...(road ? { m: i * 1.6, alt: 400 + 0.03 * i * 1.6 } : {}),
	}));
	const saved = await call(page, 'POST', '/api/rides', {
		workoutName: name,
		workoutJson: JSON.stringify({
			name,
			author: 'design shots',
			steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
		}),
		// Hours back, and apart: nobody rides two at once (the server's 409).
		startedAt: new Date(Date.now() - (road ? 4 : 2) * 3_600_000).toISOString(),
		samples,
		...(road ? { routeId: road } : {}),
	});
	if (saved.status !== 201 && saved.status !== 200)
		throw new Error(`saving the ride: ${JSON.stringify(saved)}`);
	const again = (
		await call<{ rides: RideRow[] }>(page, 'GET', '/api/rides')
	).body.rides?.find((r) => r.workoutName === name);
	if (!again) throw new Error(`the ${name} never reached /api/rides`);
	return again.id;
}

/**
 * The ride a session just saved for this rider: the newest of theirs, once
 * the save — which runs after the session closes — has landed (#3738).
 */
export async function newestRide(page: Page, after: number): Promise<string> {
	for (let tries = 0; tries < 30; tries++) {
		const rows = (
			await call<{ rides: (RideRow & { startedAt: string })[] }>(
				page,
				'GET',
				'/api/rides',
			)
		).body.rides;
		const fresh = rows
			?.filter((r) => Date.parse(r.startedAt) >= after)
			.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
		if (fresh) return fresh.id;
		await page.waitForTimeout(1000);
	}
	throw new Error('the session saved no ride');
}

/**
 * A workout that asks 1,100 W, so the head's watts reach four digits: the
 * simulated trainer follows an ERG target (validate.ts allows 3,000 W).
 */
export async function bigWatts(page: Page): Promise<string> {
	const name = 'Design four digits';
	type Shelf = { workouts: { id: string; name: string }[] };
	const found = (
		await call<Shelf>(page, 'GET', '/api/workouts')
	).body.workouts.find((w) => w.name === name);
	if (found) return found.id;
	const made = await call<{ id: string }>(page, 'POST', '/api/workouts', {
		workout: { name, steps: [{ type: 'steady', seconds: 600, watts: 1100 }] },
	});
	if (made.status !== 201 && made.status !== 200)
		throw new Error(`saving the workout: ${JSON.stringify(made)}`);
	return made.body.id;
}

/** A saved workout, so the shelf under "Your workouts" has a card to draw. */
export async function ownWorkout(page: Page): Promise<string> {
	const name = 'Design own workout';
	type Shelf = { workouts: { id: string; workout: { name: string } }[] };
	const found = (
		await call<Shelf>(page, 'GET', '/api/workouts')
	).body.workouts.find((w) => w.workout.name === name);
	if (found) return found.id;
	const made = await call<{ id: string }>(page, 'POST', '/api/workouts', {
		workout: {
			name,
			steps: [
				{ type: 'steady', seconds: 300, watts: 120 },
				{ type: 'steady', seconds: 600, watts: 200 },
			],
		},
	});
	if (made.status !== 201 && made.status !== 200)
		throw new Error(`saving the workout: ${JSON.stringify(made)}`);
	return made.body.id;
}
