import { expect, test } from './crew';

/**
 * What the You Home says reaches you inside a crew (#2586): WattRoom opens in
 * your crew since #2576, so a friend request, a friend around elsewhere and
 * your week were a page away that nobody visits first. Each was a silent
 * loss — nothing broke, the crew Home simply never said it.
 */
const A = 'You Crew Owner';
const B = 'You Crew Friend';

const idOf = (page: import('@playwright/test').Page) =>
	page.evaluate(() =>
		fetch('/api/me')
			.then((res) => res.json())
			.then((me) => String(me.id ?? '')),
	);

test('a crew Home carries your week, your friends around and your news', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const b = await riders(B);
	const opened = await channels.open(a, `You Crew ${Date.now() % 100000}`);
	const aId = await idOf(a);
	const bId = await idOf(b);
	// Whatever standing an earlier run left them in, cleared.
	await a.evaluate(
		(id) => fetch(`/api/friends/${id}`, { method: 'DELETE' }),
		bId,
	);
	await b.evaluate(
		(id) => fetch(`/api/friends/${id}`, { method: 'DELETE' }),
		aId,
	);

	// B asks A, by A's code.
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

	// A, in their crew: the name card says a friend is waiting, and the crew
	// Home says A's week.
	await a.goto(`/crew/${opened.crew}`);
	await expect(a.getByTestId('you-news')).toBeVisible();
	await expect(a.getByTestId('you-news')).toHaveAttribute(
		'title',
		/waiting for you to answer/,
	);
	await expect(a.getByRole('link', { name: /You this week/ })).toBeVisible();

	// Accepted, B — online, and in no channel of A's crew — is around.
	const accepted = await a.evaluate(
		(id) =>
			fetch(`/api/friends/${id}/accept`, { method: 'POST' }).then(
				(res) => res.status,
			),
		bId,
	);
	expect([200, 204], `A accepting B: ${accepted}`).toContain(accepted);
	await a.goto(`/crew/${opened.crew}`);
	await expect(
		a.getByRole('heading', { name: 'friends around', level: 2 }),
	).toBeVisible();
	await expect(a.getByRole('main').getByText(B, { exact: true })).toBeVisible();
	// Nothing waiting any more: the dot goes with the request.
	await expect(a.getByTestId('you-news')).toHaveCount(0);
});
