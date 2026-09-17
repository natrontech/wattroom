import { expect, test } from './room';

/**
 * What presence says on a real screen (#1743).
 *
 * The friends panel knew online and in-a-room and nothing else, so a friend on
 * the pedals read exactly like a friend chatting in the lounge — ADR-0012 has
 * named three states since its 2026-09-09 amendment. The sidebar drew its
 * rooms, its presence dots and "32 min in" with full confidence long after the
 * feed behind them stopped answering, because the error line only ever
 * rendered over an EMPTY list. And a DM now consults whatever riding screen is
 * mounted before it toasts, which the third test holds to its default: nobody
 * riding, the toast exactly as it was.
 *
 * All three are rendering and wiring, so none of them is settled by the unit
 * tests under the functions: the words, the mark and the toast have to reach a
 * screen to be worth anything.
 */

/** This spec's own rider — nobody else's (#2133). */
const A = 'Presence States Host';

test('the friends panel says riding, and names the room only to a member', async ({
	riders,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	// Four friends, one per state the panel can be in. Served as a fixture:
	// the states differ only in what the hub answered, and driving four real
	// riders onto four real trainers would prove nothing this does not.
	await a.route('**/api/friends', (route) =>
		route.fulfill({
			json: {
				code: 'PRSNC001',
				declines: [],
				friends: [
					{
						id: 'peer-shared',
						name: 'Ruben Shared',
						status: 'accepted',
						at: 1,
						online: true,
						inRoom: true,
						riding: true,
						room: 'velvet-hammer',
						roomName: 'Velvet Hammer',
					},
					{
						id: 'peer-elsewhere',
						name: 'Kim Elsewhere',
						status: 'accepted',
						at: 2,
						online: true,
						inRoom: true,
						riding: true,
					},
					{
						id: 'peer-lounging',
						name: 'Dana Lounging',
						status: 'accepted',
						at: 3,
						online: true,
						inRoom: true,
					},
					{
						id: 'peer-idle',
						name: 'Ada Idle',
						status: 'accepted',
						at: 4,
						online: true,
					},
				],
			},
		}),
	);

	await a.goto('/friends');
	const row = (id: string) =>
		a
			.locator('div')
			.filter({ has: a.locator(`a[href="/u/${id}"]`) })
			.last();

	await expect(row('peer-shared')).toBeVisible({ timeout: 15_000 });
	// A member of the room gets its name and the state in one line.
	await expect(row('peer-shared')).toContainText('riding in Velvet Hammer');
	// A room the viewer is not in stays unnamed — ADR-0012's own words for it.
	await expect(row('peer-elsewhere')).toContainText('riding elsewhere');
	await expect(row('peer-elsewhere')).not.toContainText('Velvet');
	// Riding is never inferred from being in a room (#2168).
	await expect(row('peer-lounging')).toContainText('in a room');
	await expect(row('peer-idle')).toContainText('online');
});

test('the sidebar marks its crew header when the feed stops answering', async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	// A crew to hold the mark, and a room in it — with rooms on screen the
	// column's error line never draws, which is the whole gap.
	await rooms.open(a, `Presence States ${Date.now() % 100000}`);
	const mark = a.locator('[aria-label="not updating — retrying"]');
	await expect(mark).toHaveCount(0);

	// The read refuses from here on. The list already on screen stays.
	await a.route('**/api/rooms', (route) =>
		route.fulfill({
			status: 503,
			json: { error: 'rate_limited', message: 'The rooms are unavailable.' },
		}),
	);
	// A tab coming back re-fetches (presence.svelte.ts) — the honest way to
	// drive a read from a test, and the one a sleeping laptop takes.
	const refetch = () =>
		a.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

	// One failure is a blip the 60 s fallback poll already covers.
	await refetch();
	await expect(mark).toHaveCount(0);

	// The second in a row is a feed that has stopped answering.
	await refetch();
	await expect(mark).toBeVisible({ timeout: 15_000 });

	// And one good read takes it back off.
	await a.unroute('**/api/rooms');
	await refetch();
	await expect(mark).toHaveCount(0, { timeout: 15_000 });
});

test('a DM off a ride still toasts, exactly as it did', async ({ riders }) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	// The DM path now carries an arrival KIND and consults whatever riding
	// screen is mounted (#1743). Nobody is riding here, so the toast that was
	// always the answer has to still be the answer.
	let arrived = false;
	await a.route('**/api/dms', (route) =>
		route.fulfill({
			json: {
				conversations: arrived
					? [
							{
								peerId: 'peer-writer',
								peerName: 'Ruben Writes',
								text: 'on my way',
								mine: false,
								at: Date.now(),
							},
						]
					: [],
			},
		}),
	);
	await a.goto('/home');
	// The first answer is the state of the world, not a burst of arrivals —
	// so the empty one has to land before the line does.
	await a.waitForTimeout(500);
	arrived = true;

	const toast = a
		.getByRole('region', { name: 'notifications' })
		.getByText('Ruben Writes: on my way');
	// The heads poll is 10 s; one round of it is what this is waiting for.
	await expect(toast).toBeVisible({ timeout: 20_000 });
});
