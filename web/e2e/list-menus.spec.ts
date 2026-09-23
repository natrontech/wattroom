import { expect, test } from './crew';

/**
 * Every object with more than one action gets a context menu (ux.md), on
 * every surface it is drawn — the messages list is the sidebar below `md`
 * (#2171) and its rows had arrived without theirs. Its rows are
 * conversations now: a crew's talk lives in its text channels (ADR-0058),
 * which only the crew's own column draws.
 */

/** This spec's own rider — nobody else's (#2133). */
const RIDER = 'List Menus Rider';

test("a conversation's row offers the person's menu, and a ride's its verbs", async ({
	riders,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(RIDER);
	// The peer and the ride are the server's answers, stubbed: this is about
	// the row's menu, and a real friendship and a real ride are two other
	// specs' subjects (chat-focus.spec.ts, ride.spec.ts).
	await a.route('**/api/dms', (route) =>
		route.fulfill({
			json: {
				conversations: [
					{
						peerId: 'list-menus-peer',
						peerName: 'Row Menu Peer',
						text: 'Hello',
						mine: false,
						at: Date.now(),
					},
				],
			},
		}),
	);
	await a.route('**/api/rides', (route) =>
		route.fulfill({
			json: {
				rides: [
					{
						id: 'list-menus-ride',
						workoutName: 'Sweet Spot',
						startedAt: new Date().toISOString(),
						seconds: 1800,
						kj: 420,
						avgWatts: 200,
						execution: 90,
						ftp: 250,
						xp: 10,
						sharedWithFriends: false,
					},
				],
			},
		}),
	);

	await a.setViewportSize({ width: 375, height: 812 });
	await a.goto('/messages');
	await a
		.getByTestId('thread-list')
		.getByRole('listitem')
		.filter({ hasText: 'Row Menu Peer' })
		.first()
		.click({ button: 'right' });
	await expect(
		a.getByRole('menuitem', { name: 'Open the conversation' }),
	).toBeVisible();
	await a.keyboard.press('Escape');

	// Home's last three rides: the same ride carries these on /history.
	await a.goto('/home');
	// The row, by the ride it opens: Home's week summary says "30 min" too.
	const ride = a
		.locator('li')
		.filter({ has: a.locator('a[href="/history/list-menus-ride"]') });
	await expect(ride).toBeVisible({ timeout: 15_000 });
	// Let the row stop moving first: a menu closes on a scroll that moves
	// what it is anchored to (#500) — Playwright's own scroll to a row this far
	// down a phone's Home, or a section above it landing late. A fixed wait
	// guessed at both and lost under load (#2504): "Share with friends" was
	// found, then the menu closed before "Delete ride" was.
	await ride.scrollIntoViewIfNeeded();
	let last = '';
	await expect
		.poll(
			async () => {
				const box = JSON.stringify(await ride.boundingBox());
				const still = box === last;
				last = box;
				return still;
			},
			{ intervals: [250], message: 'the ride row never stopped moving' },
		)
		.toBe(true);
	await ride.click({ button: 'right' });
	await expect(
		a.getByRole('menuitem', { name: 'Share with friends' }),
	).toBeVisible();
	await expect(a.getByRole('menuitem', { name: 'Delete ride' })).toBeVisible();
});
