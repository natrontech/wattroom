import { expect, test } from './crew';

/**
 * One person, one row shape, and a page that can answer both ways (#2172).
 * An incoming request used to be a bare name and two buttons — no face, no
 * menu — and an ask of yours plain text with no link at all; the rider page
 * the panel sends you to ("see who before you accept") offered Accept and
 * nothing else.
 */

/** This spec's own riders — nobody else's (#2133). */
const A = 'Friend Rows Host';
const B = 'Friend Rows Other';

/** Whatever standing these two are left in by an earlier run, cleared. */
async function forget(page: import('@playwright/test').Page, peerId: string) {
	await page.evaluate(
		(id) => fetch(`/api/friends/${id}`, { method: 'DELETE' }),
		peerId,
	);
}

const idOf = (page: import('@playwright/test').Page) =>
	page.evaluate(() =>
		fetch('/api/me')
			.then((res) => res.json())
			.then((me) => String(me.id ?? '')),
	);

test('a friend request is a row like any other, answerable from either side', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const b = await riders(B);
	// A channel they share: a rider page is gated on a channel both may
	// enter or a friendship (SharesChannelOrFriends, ADR-0058), and the one
	// being asked can see the asker while the asker cannot see them — which
	// is the door this issue is about, so both sides need to be able to open
	// it.
	const opened = await channels.open(a, `Friend Rows ${Date.now() % 100000}`);
	await channels.enter(b, opened);
	const aId = await idOf(a);
	const bId = await idOf(b);
	await forget(a, bId);
	await forget(b, aId);

	// B asks A, by A's code: a request by id wants a shared channel
	// (friends.go).
	const code = await a.evaluate(() =>
		fetch('/api/friends')
			.then((res) => res.json())
			.then((f) => String(f.code ?? '')),
	);
	const asked = await b.evaluate(
		(c) =>
			fetch('/api/friends', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ code: c }),
			}).then((res) => res.status),
		code,
	);
	expect([200, 201, 204], `B asking A: ${asked}`).toContain(asked);

	// The rider being asked: the row carries a face, the way to their page
	// and the menu, and the menu names the act that exists here.
	await a.goto('/friends');
	const asking = a
		.locator('div')
		.filter({ has: a.locator(`a[href="/u/${bId}"]`) })
		.last();
	await expect(asking).toBeVisible({ timeout: 15_000 });
	await expect(asking.locator(`[title^="${B}"]`)).toBeVisible();
	await asking.click({ button: 'right' });
	await expect(
		a.getByRole('menuitem', { name: 'Dismiss the request' }),
	).toBeVisible();
	// Not the friendship's exit — there is no friendship to end yet.
	await expect(a.getByRole('menuitem', { name: 'Remove friend' })).toHaveCount(
		0,
	);
	await a.keyboard.press('Escape');

	// The page the panel sends them to can say no as well as yes.
	await a.goto(`/u/${bId}`);
	await expect(a.getByRole('button', { name: 'Accept friend' })).toBeVisible();
	await expect(a.getByRole('button', { name: 'Dismiss' })).toBeVisible();

	// The rider who asked: the same row, and the way back out on both
	// surfaces (#2008 gave the panel one; the page had none).
	await b.goto('/friends');
	const asked_row = b
		.locator('div')
		.filter({ has: b.locator(`a[href="/u/${aId}"]`) })
		.last();
	await expect(asked_row).toBeVisible({ timeout: 15_000 });
	await expect(asked_row.locator(`[title^="${A}"]`)).toBeVisible();
	await expect(
		asked_row.getByRole('button', { name: 'Withdraw' }),
	).toBeVisible();
	await asked_row.click({ button: 'right' });
	await expect(
		b.getByRole('menuitem', { name: 'Withdraw the request' }),
	).toBeVisible();
	await b.keyboard.press('Escape');

	await b.goto(`/u/${aId}`);
	const withdraw = b.getByRole('button', { name: 'Withdraw' });
	await expect(withdraw).toBeVisible();

	// And it works, which also leaves these two as the next run finds them.
	await withdraw.click();
	await expect(b.getByRole('button', { name: 'Add friend' })).toBeVisible();
});

test('a long name gives way instead of pushing the row off the phone', async ({
	riders,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	// docs/SPEC.md allows 60 characters; the dev provider's own names are
	// short, so the row is fed one (#2182).
	const long = 'Bartholomew Wolfeschlegelsteinhausenbergerdorff the Third';
	await a.route('**/api/friends', (route) =>
		route.fulfill({
			json: {
				code: 'LONGNM',
				declines: [],
				friends: [
					{
						id: 'long-name-peer',
						name: long,
						status: 'accepted',
						at: Date.now(),
						totalXp: 10,
					},
				],
			},
		}),
	);

	await a.setViewportSize({ width: 375, height: 812 });
	await a.goto('/friends');
	// The panel's own row: the sidebar names them too, one column away.
	const name = a
		.locator('a[href="/u/long-name-peer"]')
		.filter({ hasText: long })
		.last();
	await expect(name).toBeVisible({ timeout: 15_000 });

	// Truncated, rather than a row three controls wide with no space left.
	const cut = await name.evaluate((el) => el.scrollWidth - el.clientWidth);
	expect(cut, 'the name is not truncated at all').toBeGreaterThan(0);
	const remove = a.getByRole('button', { name: 'Remove' });
	const box = (await remove.boundingBox())!;
	expect(
		box.x + box.width,
		`Remove ends at ${Math.round(box.x + box.width)}px of a 375px phone`,
	).toBeLessThanOrEqual(375);
});
