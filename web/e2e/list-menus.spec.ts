import { expect, test, textPath } from './crew';

/**
 * Every object with more than one action gets a context menu (ux.md), on
 * every surface it is drawn — the messages list is the sidebar below `md`
 * (#2171) and its rows had arrived without theirs. Its rows are
 * conversations now: a crew's talk lives in its text channels (ADR-0058),
 * which the crew's own column draws — the drawer, on a phone.
 */

/** This spec's own riders — nobody else's (#2133). */
const RIDER = 'List Menus Rider';
const OTHER = 'List Menus Other';

test("a channel's row in the crew column carries the sidebar's own menu", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(RIDER);
	const opened = await channels.open(a, `List Menus ${Date.now() % 100000}`);

	// A line the owner has not read, so "Mark as read" has something to do:
	// the menu offers it only on a text channel with unread.
	const b = await riders(OTHER);
	await channels.enter(b, opened);
	const said = await b.evaluate(
		(id) =>
			fetch(`/api/channels/${id}/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: 'unread for the owner' }),
			}).then((res) => res.status),
		opened.text,
	);
	expect(said, 'the member could not say a line in the channel').toBe(200);

	// A member's menu opens the channel and manages nothing: the gate, the
	// rename and the delete are the crew's owner's and admins' (ADR-0058),
	// and a menu item the server would refuse is a control that fails on
	// click (ux.md).
	const bRow = b
		.locator('nav[aria-label="crews and channels"]')
		.locator(`a[href="${textPath(opened)}"]`);
	await bRow.click({ button: 'right' });
	await expect(b.getByRole('menuitem', { name: 'Open' })).toBeVisible();
	await expect(
		b.getByRole('menuitem', { name: 'Delete the channel' }),
	).toHaveCount(0);
	await expect(
		b.getByRole('menuitem', { name: 'Make it private' }),
	).toHaveCount(0);
	await b.keyboard.press('Escape');

	// The owner, on a phone: the column is the drawer, and #2171 was a list
	// that stood in for the sidebar there and arrived without its menus. On
	// the crew's Home, not the channel, which would read the line.
	await a.setViewportSize({ width: 375, height: 812 });
	await a.goto(`/crew/${opened.crew}`);
	await a.getByRole('button', { name: 'open navigation' }).click();
	const row = a
		.locator('nav[aria-label="crews and channels"]')
		.locator(`a[href="${textPath(opened)}"]`);
	// The unread count on the row, before the menu is read off it: the column
	// learns of the line on a lobby ping, and a menu opened ahead of it would
	// be missing "Mark as read" for a reason that is not the menu's.
	await expect(row).toHaveText(new RegExp(`^\\s*${opened.name}\\s*1\\s*$`), {
		timeout: 15_000,
	});
	await row.click({ button: 'right' });

	// The column's own builder: open, read, then the admin's.
	for (const item of [
		'Open',
		'Mark as read',
		'Make it private',
		'Rename in settings',
		'Delete the channel',
	])
		await expect(a.getByRole('menuitem', { name: item })).toBeVisible();

	// The channel is where the row said it would be.
	await a.getByRole('menuitem', { name: 'Open' }).click();
	await expect(a).toHaveURL(new RegExp(`${textPath(opened)}$`));
	await expect(a.getByPlaceholder(`Message ${opened.name}…`)).toBeVisible();
});

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
