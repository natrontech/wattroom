import { expect, test } from './room';

/**
 * The invite is the crew's (ADR-0038 amended, #1236): one link, /c/{code},
 * carries a rider from anywhere into the crew and then into its open rooms.
 * This is that journey as a second real session sees it — the sign-in gate a
 * signed-out visitor meets first, which names the crew (#1296); the door
 * before the join; the crew page after it; the room's own door opening; and
 * the link read again as a member, which is no longer an invite.
 *
 * Every earlier spec enters a room through the Home form (`rooms.enter`), so
 * the link itself — the thing riders actually paste to each other — had no
 * test until this one.
 */

/** The second dev rider. `?as=` accepts letters and spaces (auth.go). */
const B = 'Ruben';

test("a crew's invite link carries a rider in: gate, door, crew, room", async ({
	browser,
	baseURL,
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders();
	const name = `Crew Invite ${Date.now() % 100000}`;
	const room = await rooms.open(a, name);
	// The door is public (#1236): what the link shows before anyone signs in.
	const crewName: string = await a.evaluate(
		(code) =>
			fetch(`/api/crew-doors/${code}`)
				.then((res) => res.json())
				.then((door) => door.name),
		room.code,
	);
	expect(crewName).not.toBe('');

	// 1. Signed out, the link lands on the gate — and the gate says whose
	//    crew is on the other side (#1296), not "train together" alone.
	const visitor = await browser.newContext({ baseURL });
	const v = await visitor.newPage();
	await v.goto(`/c/${room.code}`);
	await v.waitForURL(/\/login\?next=/);
	await expect(v.getByText('You are invited to')).toBeVisible();
	await expect(v.getByText(crewName, { exact: true })).toBeVisible();
	await visitor.close();

	// 2. Signed in and not in the crew: the door, then the join, then the
	//    crew's page with A's room on it.
	const b = await riders(B);
	await b.goto(`/c/${room.code}`);
	await expect(
		b.getByText('You have been invited to ride with this crew'),
	).toBeVisible();
	await b.getByRole('button', { name: `Join ${crewName}` }).click();
	// A one-room crew lands the newcomer in the room they came for (#1931),
	// not on the crew's roster with a code above it.
	await b.waitForURL(new RegExp(`/r/${room.slug}`), { timeout: 15_000 });

	// 3. A room open to the crew opens: the door says walk in, and it does.
	await b.getByRole('button', { name: 'Walk in' }).click();
	await expect(b.getByRole('heading', { name })).toBeVisible({
		timeout: 15_000,
	});

	// 4. The same link, read by a member, is a way to the crew — not an
	//    invite to a crew they are already in.
	await b.goto(`/c/${room.code}`);
	await expect(b.getByRole('link', { name: `Open ${crewName}` })).toBeVisible();
	await expect(b.getByRole('button', { name: `Join ${crewName}` })).toHaveCount(
		0,
	);
});
