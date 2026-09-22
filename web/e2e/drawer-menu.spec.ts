import { expect, test } from './room';

/**
 * The phone drawer and what it raises — from its menus (#2153) and from its
 * own buttons (#2142). The drawer is
 * `z-50` and stayed open by itself, so a confirm dialog (`z-40`) came up
 * mostly behind it with the focus trap holding focus inside, and a toast —
 * `z-50` too, and mounted earlier — showed a right-hand sliver and its ×.
 *
 * Two properties, one flow: the drawer steps aside for the action it was
 * asked for, and a toast is readable even with the drawer back over it.
 */

/** This spec's own riders — nobody else's (#2133). */
const RIDER = 'Drawer Menu Rider';
const OTHER = 'Drawer Menu Other';
const BUTTON_RIDER = 'Drawer Button Rider';
const PHONE = { width: 375, height: 812 };

test('an action picked in the phone drawer is not left under it', async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(RIDER);
	await a.setViewportSize(PHONE);
	// The first room founds the crew whose row carries the menu.
	const mine = await rooms.open(a, `Drawer Menu ${Date.now() % 100000}`);

	// On the crew's own page the column is that crew (#2447), and its header
	// is the row that carries the crew's menu.
	await a.goto(`/crew/${mine.crew}`);
	const hamburger = a.getByRole('button', { name: 'open navigation' });
	await hamburger.click();
	await expect(hamburger).toHaveAttribute('aria-expanded', 'true');

	// Long-press is the finger's right-click; Playwright's right button opens
	// the same menu through the same handler. "Copy invite link" is the item
	// that raises a toast either way — a clipboard the browser refuses says
	// so in one, which is the point of that fallback.
	await a.getByRole('button', { name: /^crew: .* switch crew$/ }).click({
		button: 'right',
	});
	await a.getByRole('menuitem', { name: 'Copy invite link' }).click();

	// The drawer went, rather than staying over whatever the item raised —
	// this is what a confirm dialog at z-40 depends on.
	await expect(hamburger).toHaveAttribute('aria-expanded', 'false');

	const toast = a
		.getByRole('region', { name: 'notifications' })
		.getByRole('status')
		.or(a.getByRole('region', { name: 'notifications' }).getByRole('alert'));
	await expect(toast).toBeVisible();
	// The pointer resting on the stack pauses every toast's clock; leaving it
	// gives every toast a second more, which is the window the rest of this
	// runs in. The click is also the check from #2210: the stack sat over the
	// navigation button, so this very line used to be refused.
	await toast.hover();
	await hamburger.click();
	await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
	await a.waitForTimeout(300); // the drawer's 200 ms slide

	const hit = await toast.evaluate((el) => {
		const box = el.getBoundingClientRect();
		const on = document.elementFromPoint(
			box.left + box.width / 2,
			box.top + box.height / 2,
		);
		return {
			mine: el.contains(on),
			what: on
				? `${on.tagName.toLowerCase()}.${on.className}`.slice(0, 60)
				: '',
		};
	});
	expect(hit.mine, `the toast's centre hits ${hit.what}`).toBe(true);

	// And the dialog the issue was reported for: a crew this rider is in but
	// does not own, whose menu offers a confirm. Under an open drawer it came
	// up with its body and its danger button behind it, while the focus trap
	// held focus inside (#2153).
	const b = await riders(OTHER);
	const theirs = await rooms.open(b, `Drawer Other ${Date.now() % 100000}`);
	await rooms.enter(a, theirs);
	const crew = await a.evaluate(
		(slug) =>
			fetch(`/api/rooms/${slug}`)
				.then((res) => res.json())
				.then((r) => String(r.crew?.name ?? '')),
		theirs.slug,
	);

	await a.goto('/home');
	await hamburger.click();
	// The switcher's list is where the other crew's own menu lives — on
	// Home the column is You (#2447), with every crew one row below it.
	await a.getByRole('button', { name: /switch crew/ }).click();
	await a
		.getByRole('button', { name: new RegExp(`${crew}\\s+\\d+ channels?`) })
		.click({ button: 'right' });
	await a.getByRole('menuitem', { name: 'Leave the crew' }).click();

	await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
	const dialog = a.getByRole('dialog');
	const danger = dialog.getByRole('button', { name: 'Leave the crew' });
	await expect(danger).toBeVisible();
	const onDanger = await danger.evaluate((el) => {
		const box = el.getBoundingClientRect();
		const on = document.elementFromPoint(
			box.left + box.width / 2,
			box.top + box.height / 2,
		);
		return {
			mine: el.contains(on),
			what: on
				? `${on.tagName.toLowerCase()}.${on.className}`.slice(0, 60)
				: '',
		};
	});
	expect(
		onDanger.mine,
		`the danger button's centre hits ${onDanger.what}`,
	).toBe(true);
	// Nothing left behind: the safe answer, which the trap focuses first.
	await dialog.getByRole('button', { name: 'Keep it' }).click();
});

/**
 * #2142, the other half of the same layering: a dialog opened by a plain
 * BUTTON in the drawer, with no menu in between. Every AV control a phone has
 * lives in the you-panel inside the drawer, and the Sound panel mounted
 * underneath it — invisible, with every tap meant for it landing on the
 * drawer. The `+` beside a crew's channels is the same shape and needs no voice
 * session to reach, so it is what this rides.
 *
 * It used to be hand-wired: the `+` called an `onSheet` prop the layout
 * turned into "close the drawer", and every other dialog the drawer can raise
 * was left buried. The count of open modals answers for all of them now, and
 * this is the test that the hand-wiring's removal did not take the `+` with
 * it.
 */
test('a dialog opened by a button in the phone drawer comes up over it', async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(BUTTON_RIDER);
	await a.setViewportSize(PHONE);
	// The + sits beside a crew's channels, for its owner (#2447), so there
	// has to be a crew of theirs on screen.
	const room = await rooms.open(a, `Drawer Button ${Date.now() % 100000}`);

	await a.goto(`/crew/${room.crew}`);
	const hamburger = a.getByRole('button', { name: 'open navigation' });
	await hamburger.click();
	await expect(hamburger).toHaveAttribute('aria-expanded', 'true');

	await a.getByRole('button', { name: 'new text channel' }).click();

	await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
	const dialog = a.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await a.waitForTimeout(300); // the drawer's 200 ms slide

	// Visible is not reachable: the drawer is z-50 over the dialog's z-40, so
	// what the rider taps is the question. The top of the dialog is where the
	// drawer would still be over it.
	const hit = await dialog.evaluate((el) => {
		const box = el.getBoundingClientRect();
		const on = document.elementFromPoint(box.left + box.width / 2, box.top + 8);
		return {
			mine: el.contains(on),
			what: on
				? `${on.tagName.toLowerCase()}.${on.className}`.slice(0, 60)
				: '',
		};
	});
	expect(hit.mine, `the top of the dialog hits ${hit.what}`).toBe(true);
});
