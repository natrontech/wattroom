import type { Page } from '@playwright/test';
import { expect, test, textPath } from './crew';

/**
 * A crew admin bans from a line in a text channel (#2530): chat is where you
 * meet the griefer (#1765). Behind the same confirm as the Members page
 * (#1674), and never on the owner's lines.
 */
const A = 'Message Ban Owner';
const B = 'Message Ban Admin';
const C = 'Message Ban Member';

const idOf = (page: Page) =>
	page.evaluate(() =>
		fetch('/api/me')
			.then((res) => res.json())
			.then((me) => String(me.id)),
	);

const say = (page: Page, channel: string, text: string) =>
	page.evaluate(
		({ channel, text }) =>
			fetch(`/api/channels/${channel}/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text }),
			}).then((res) => res.status),
		{ channel, text },
	);

test("a crew admin bans from a text channel's line, and never the owner", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Message Ban ${Date.now() % 100000}`);
	const b = await riders(B);
	await channels.enter(b, opened);
	const c = await riders(C);
	await channels.enter(c, opened);
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

	const n = Date.now() % 100000;
	const fromOwner = `owner line ${n}`;
	const fromMember = `member line ${n}`;
	expect(await say(a, opened.text, fromOwner)).toBeLessThan(300);
	expect(await say(c, opened.text, fromMember)).toBeLessThan(300);

	await b.goto(textPath(opened));
	const lines = b.getByTestId('thread-message');
	const ban = b.getByRole('menuitem', { name: 'Ban from the crew' });

	// The owner's line: the menu opens on the person, and holds no ban.
	await lines.filter({ hasText: fromOwner }).click({ button: 'right' });
	await expect(b.getByRole('menuitem', { name: 'Rider page' })).toBeVisible();
	await expect(ban).toHaveCount(0);
	await b.keyboard.press('Escape');

	// A member's line: last in the menu, behind the confirm.
	await lines.filter({ hasText: fromMember }).click({ button: 'right' });
	await ban.click();
	await b.getByRole('button', { name: 'Ban', exact: true }).click();
	await expect(b.getByText(`Banned ${C} from the crew.`)).toBeVisible();
	const seen = await c.evaluate(
		(crew) => fetch(`/api/crews/${crew}`).then((res) => res.status),
		opened.crew,
	);
	expect(seen, 'banned is out of the crew').toBe(404);

	// Lifted, so the fixture can hand the crew back.
	expect(await setRole(cId, 'member')).toBeLessThan(300);
});
