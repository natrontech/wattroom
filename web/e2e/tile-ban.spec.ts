import { expect, test, voicePath } from './crew';

/**
 * A crew admin bans from a rider's tile in a voice channel (#2529) — the
 * roles matrix gives admins the ban (docs/SPEC.md), and ux.md wants it met
 * where the griefer is. Never on the owner's tile, and behind the crew's
 * one ban question (#2542).
 */
const A = 'Tile Ban Owner';
const B = 'Tile Ban Admin';
const C = 'Tile Ban Member';

test("a crew admin bans from a voice channel's tile, and never the owner", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Tile Ban ${Date.now() % 100000}`);
	const b = await riders(B);
	await channels.enter(b, opened);
	const c = await riders(C);
	await channels.enter(c, opened);

	const idOf = (page: typeof a) =>
		page.evaluate(() =>
			fetch('/api/me')
				.then((res) => res.json())
				.then((me) => String(me.id)),
		);
	const [bId, cId] = [await idOf(b), await idOf(c)];
	const setRole = (userId: string, role: string) =>
		a.evaluate(
			({ crew, userId, role }) =>
				fetch(`/api/crews/${crew}/role`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ userId, role }),
				}).then((res) => res.status),
			{ crew: opened.crew, userId, role },
		);
	expect(await setRole(bId, 'admin')).toBeLessThan(300);

	await a.goto(voicePath(opened));
	await b.goto(voicePath(opened));
	const tiles = b.getByTestId('rider-tile');
	await expect(tiles, 'the three riders never reached the roster').toHaveCount(
		3,
		{ timeout: 20_000 },
	);
	const ban = b.getByRole('menuitem', { name: 'Ban from the crew' });

	// The owner's tile: the menu opens, and holds no ban.
	await tiles.filter({ hasText: A }).first().click({ button: 'right' });
	await expect(b.getByRole('menuitem', { name: 'Rider page' })).toBeVisible();
	await expect(ban).toHaveCount(0);
	await b.keyboard.press('Escape');

	// A member's tile: the admin bans, and the crew says so.
	await tiles.filter({ hasText: C }).first().click({ button: 'right' });
	await ban.click();
	// The Members page's question (#2542): no ban lands before it is answered.
	const ask = b.getByRole('dialog');
	await expect(ask).toContainText(`Ban ${C} from the crew?`);
	await ask.getByRole('button', { name: 'Ban', exact: true }).click();
	await expect(b.getByText(`Banned ${C} from the crew.`)).toBeVisible();
	// Banned is out of the crew: it answers them as if it were not there.
	const seen = await c.evaluate(
		(crew) => fetch(`/api/crews/${crew}`).then((res) => res.status),
		opened.crew,
	);
	expect(seen).toBe(404);

	// Lifted, so the fixture can hand the crew back.
	expect(await setRole(cId, 'member')).toBeLessThan(300);
});
