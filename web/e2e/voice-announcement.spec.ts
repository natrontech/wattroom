import { expect, test } from './crew';

/**
 * A voice channel's Lounge strip carries the crew's newest announcement
 * (ADR-0058 on 0057), and its take-down button must take it down — it was
 * drawn for the crew's owner and admins and did nothing (#2528).
 */
test("a voice channel's Lounge takes the crew's announcement down, and Undo puts it back", async ({
	riders,
	channels,
}) => {
	const page = await riders('Voice Announcer');
	const opened = await channels.open(page, `Announce ${Date.now() % 100000}`);

	const marked = await page.evaluate(async (id) => {
		const line = await fetch(`/api/channels/${id}/chat`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: 'Friday is a recovery spin' }),
		}).then((res) => res.json());
		const res = await fetch(`/api/channels/${id}/announcement`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ messageId: line.id }),
		});
		return res.status;
	}, opened.text);
	expect(marked).toBe(200);

	// channels.open left the rider in the voice channel; the strip is read
	// when the page loads.
	await page.reload();
	const notice = page.getByText('Friday is a recovery spin');
	await expect(notice).toBeVisible();

	await page
		.getByRole('button', { name: 'Take the announcement down' })
		.click();
	await expect(notice).toHaveCount(0);
	const undo = page.getByRole('button', { name: 'Undo' });
	await expect(undo).toBeVisible();

	// Taken down for real — the text channel no longer has one either.
	const left = await page.evaluate(
		(crew) =>
			fetch(`/api/crews/${crew}/announcement`).then((res) =>
				res.status === 204 ? null : res.json(),
			),
		opened.crew,
	);
	expect(left?.text ?? null).toBeNull();

	await undo.click();
	await expect(notice).toBeVisible();

	// Clearing is the crew's owner's and admins' (ADR-0058): a member sees the
	// notice without the button, and an admin gets it.
	const other = await riders('Voice Announcee');
	await channels.enter(other, opened);
	await expect(other.getByText('Friday is a recovery spin')).toBeVisible();
	const takeDown = other.getByRole('button', {
		name: 'Take the announcement down',
	});
	await expect(takeDown).toHaveCount(0);
	const otherId = await other.evaluate(() =>
		fetch('/api/me')
			.then((res) => res.json())
			.then((me) => String(me.id)),
	);
	const promoted = await page.evaluate(
		({ crew, userId }) =>
			fetch(`/api/crews/${crew}/role`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ userId, role: 'admin' }),
			}).then((res) => res.status),
		{ crew: opened.crew, userId: otherId },
	);
	expect(promoted).toBeLessThan(300);
	await other.reload();
	await expect(takeDown).toBeVisible();
});
