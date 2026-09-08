import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './signin';

/**
 * Nothing outside a room may scroll sideways on a phone (#1008).
 *
 * The obvious assertion — `documentElement.scrollWidth <= clientWidth` — is
 * useless in this app, and measurably so: the shell wraps the page in
 * `overflow-hidden` columns, so a chart 307px wider than a 375px viewport left
 * the document at exactly 375 and the check green. The overflow is absorbed by
 * `[data-testid=page-body]`, which is therefore what has to be measured.
 *
 * A widget that genuinely needs to be wide — a table, a long row — wraps
 * itself in its own `overflow-x: auto` and does not widen the body, so this
 * stays true without exempting anything.
 */
const PHONE = { width: 375, height: 812 };

/** Every route a rider reaches without a room. The room has its own spec. */
const ROUTES = [
	'/home',
	'/workouts',
	'/workouts/edit',
	'/music',
	'/history',
	'/rooms',
	'/friends',
	'/messages',
	'/sessions',
	'/pair',
	'/profile',
	'/trophies',
	'/whats-new',
];

test.use({ viewport: PHONE });

/**
 * A rider with no rides has no charts, and the charts are what overflowed.
 * Without this the spec passes against the very bug it exists to catch —
 * confirmed by running it against the unfixed code, where it went green.
 */
async function seedARide(page: Page): Promise<void> {
	const ok = await page.evaluate(async () => {
		const res = await fetch('/api/rides', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				workoutName: 'Phone Width Ride',
				// Parsed server-side and required to yield a segment, so it is a
				// real workout rather than an empty string.
				workoutJson: JSON.stringify({
					name: 'Phone Width Ride',
					author: 'e2e',
					steps: [{ type: 'steady', seconds: 120, target: 0.8 }],
				}),
				startedAt: new Date(Date.now() - 3_600_000).toISOString(),
				samples: Array.from({ length: 120 }, () => ({ watts: 200 })),
			}),
		});
		return res.ok;
	});
	if (!ok) throw new Error('could not seed a ride for the chart pages');
}

/**
 * And a rider with an empty music pool has no shelf row, which is the widest
 * thing on /music. Same trap as the ride above: without this the route sits in
 * ROUTES asserting nothing — confirmed by deleting the strip's `overflow-x-auto`
 * and watching the spec stay green.
 */
async function seedATaggedTrack(page: Page): Promise<void> {
	const ok: true | string = await page.evaluate(async () => {
		// MPEG 1 Layer III, 128 kbps at 44.1 kHz: a 417-byte frame, repeated.
		// The server measures the duration off these frames, so they have to be
		// real ones rather than a blob named .mp3.
		const frame = new Uint8Array(417);
		frame.set([0xff, 0xfb, 0x90, 0x00]);
		const mp3 = new Uint8Array(417 * 40);
		for (let i = 0; i < 40; i++) mp3.set(frame, i * 417);

		const upload = await fetch('/api/tracks?name=Phone%20Width.mp3', {
			method: 'POST',
			body: mp3,
		});
		if (!upload.ok) return `upload ${upload.status}`;
		const track = await upload.json();
		// Enough shelves to be wider than 375px several times over — the strip
		// has to be scrolling something for its own overflow to be tested.
		const patch = await fetch(`/api/tracks/${track.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				title: 'Phone Width',
				artist: '',
				album: '',
				bpm: null,
				tags: [
					'synthwave',
					'darksynth',
					'italo disco',
					'techno',
					'ambient',
					'warm up',
					'cool down',
					'threshold',
				],
			}),
		});
		return patch.ok ? true : `patch ${patch.status}`;
	});
	if (ok !== true) throw new Error(`could not seed a tagged track: ${ok}`);
}

test('no page outside a room scrolls sideways on a phone', async ({ page }) => {
	await signInAs(page, 'Phone Width', '/home');
	await seedARide(page);
	await seedATaggedTrack(page);

	// The crew's page (#1150, #1151) is reached by id, so it is found rather
	// than listed: every rider owns one crew from their first room.
	const crewId = await page.evaluate(async () => {
		const read = async () => {
			const res = await fetch('/api/rooms');
			const body = (await res.json()) as {
				rooms: { crew?: { id: string } }[];
			};
			return body.rooms.find((r) => r.crew)?.crew?.id ?? null;
		};
		// This rider is reused across runs (signin.ts), so the room it opens
		// on the first run is found on every later one — never a second.
		const found = await read();
		if (found) return found;
		await fetch('/api/rooms', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'Phone Width Crew' }),
		});
		return read();
	});
	// Its settings (#1237) and its door (#1236) hang off the same crew: the
	// settings are the owner's, which this rider is, and the door takes the
	// crew's code, which the crew payload carries for members.
	const crewCode = crewId
		? await page.evaluate(
				async (id) =>
					String(
						(
							(await (await fetch(`/api/crews/${id}`)).json()) as {
								code?: string;
							}
						).code ?? '',
					),
				crewId,
			)
		: '';
	const routes = crewId
		? [
				...ROUTES,
				`/crew/${crewId}`,
				`/crew/${crewId}/settings`,
				...(crewCode ? [`/c/${crewCode}`] : []),
			]
		: ROUTES;

	const wide: string[] = [];
	for (const route of routes) {
		await page.goto(route);
		const body = page.getByTestId('page-body');
		await expect(body).toBeVisible();
		// The charts size themselves from their measured container, so read
		// after layout has settled rather than on the first frame.
		await page.waitForTimeout(300);
		const excess = await body.evaluate((el) => el.scrollWidth - el.clientWidth);
		if (excess > 0) wide.push(`${route} overflows by ${excess}px`);
	}

	expect(wide, 'pages wider than a 375px phone').toEqual([]);
});
