import { expect, test, voicePath } from './crew';

/**
 * The invite is the crew's (ADR-0038 amended, #1236): one link, /c/{code},
 * carries a rider from anywhere into the crew and then into its open channels.
 * This is that journey as a second real session sees it — the sign-in gate a
 * signed-out visitor meets first, which names the crew (#1296); the door
 * before the join; the crew page after it; an open voice channel opening; and
 * the link read again as a member, which is no longer an invite.
 *
 * Every earlier spec enters a crew through the Home form (`channels.enter`),
 * so the link itself — the thing riders actually paste to each other — had no
 * test until this one.
 */

/**
 * This spec's own two riders (#2133). The host matters as much as the guest:
 * the channels are opened in the host's OWN crew, so a shared host means a
 * shared crew, and a neighbouring spec's channels and members in it would be
 * what the guest meets instead of this spec's.
 *
 * `?as=` accepts letters and spaces, up to 24, and never "Dev Rider" (auth.go).
 */
const A = 'Crew Invite Host';
const B = 'Crew Invite Guest';

test("a crew's invite link carries a rider in: gate, door, crew, channel", async ({
	browser,
	baseURL,
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const name = `Crew Invite ${Date.now() % 100000}`;
	const opened = await channels.open(a, name);
	// The door is public (#1236): what the link shows before anyone signs in.
	const crewName: string = await a.evaluate(
		(code) =>
			fetch(`/api/crew-doors/${code}`)
				.then((res) => res.json())
				.then((door) => door.name),
		opened.code,
	);
	expect(crewName).not.toBe('');

	// 1. Signed out, the link lands on the gate — and the gate says whose
	//    crew is on the other side (#1296), not "train together" alone.
	const visitor = await browser.newContext({ baseURL });
	const v = await visitor.newPage();
	await v.goto(`/c/${opened.code}`);
	await v.waitForURL(/\/login\?next=/);
	await expect(v.getByText('You are invited to')).toBeVisible();
	await expect(v.getByText(crewName, { exact: true })).toBeVisible();
	await visitor.close();

	// 2. Signed in and not in the crew: the door, then the join, then the
	//    crew's page.
	const b = await riders(B);
	await b.goto(`/c/${opened.code}`);
	await expect(
		b.getByText('You have been invited to ride with this crew'),
	).toBeVisible();
	await b.getByRole('button', { name: `Join ${crewName}` }).click();
	// The crew is what they joined, so its page is where they land (#2456).
	await b.waitForURL(/\/crew\/[0-9a-f-]+$/, { timeout: 15_000 });

	// 3. A voice channel open to the crew opens to its new member. The
	//    channel's name is its shell's sr-only heading, so attached is what
	//    "there" means.
	await b.goto(voicePath(opened));
	await expect(b.getByRole('heading', { name })).toBeAttached({
		timeout: 15_000,
	});

	// 4. The same link, read by a member, is a way to the crew — not an
	//    invite to a crew they are already in.
	await b.goto(`/c/${opened.code}`);
	await expect(b.getByRole('link', { name: `Open ${crewName}` })).toBeVisible();
	await expect(b.getByRole('button', { name: `Join ${crewName}` })).toHaveCount(
		0,
	);
});
