import { MaxCrewTextChannels } from '../src/lib/protocol';
import { expect, test } from './crew';

/**
 * Crew Settings keep the crew's channels (#2454, ADR-0058): its owner adds
 * one, renames it, shuts it to named members and deletes it, each asserted
 * against the server rather than the page — and a kind at its cap says so,
 * with the number, before anyone types a name the server would refuse.
 */

/** This spec's own rider — nobody else's (#2133). */
const A = 'Crew Settings Owner';

type Row = { id: string; kind: string; name: string; private: boolean };

test('the owner keeps the crew channels from its settings', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const { crew } = await channels.open(
		a,
		`Crew Settings ${Date.now() % 100000}`,
	);
	const listed = () =>
		a.evaluate(
			(id) =>
				fetch(`/api/crews/${id}/channels`)
					.then((res) => res.json())
					.then((body: { channels: Row[] }) => body.channels),
			crew,
		);
	const named = async (name: string) =>
		(await listed()).find((c) => c.name === name);

	// The crew outlives the run (a crew with channels is never swept,
	// #2493), so the last run's fillers go first or the cap is already met.
	await a.evaluate(async (id) => {
		const body = await fetch(`/api/crews/${id}/channels`).then((res) =>
			res.json(),
		);
		for (const channel of body.channels as { id: string; name: string }[])
			if (/^(Filler \d+|Sprints|Sprint Talk)$/.test(channel.name))
				await fetch(`/api/channels/${channel.id}`, { method: 'DELETE' });
	}, crew);
	await a.goto(`/crew/${crew}/settings`);
	await a
		.getByRole('textbox', { name: 'new text channel name' })
		.fill('Sprints');
	await a
		.getByRole('textbox', { name: 'new text channel name' })
		.press('Enter');
	await expect.poll(() => named('Sprints')).toMatchObject({ kind: 'text' });

	// Open the row; its name saves on change.
	// The page's row, not the sidebar's: the sidebar lists the crew's
	// channels too (#2447).
	await a
		.getByTestId('page-body')
		.getByText('Sprints', { exact: true })
		.click();
	const row = a.locator('details[open]');
	await row.getByRole('textbox').first().fill('Sprint Talk');
	await row.getByRole('textbox').first().press('Tab');
	await expect.poll(() => named('Sprint Talk')).toBeTruthy();

	await a
		.locator('details[open]')
		.getByRole('checkbox', { name: /Private/ })
		.check();
	await expect
		.poll(async () => (await named('Sprint Talk'))?.private)
		.toBe(true);

	// Destructive with no undo: it asks, and only the action deletes.
	await a
		.locator('details[open]')
		.getByRole('button', { name: 'Delete the channel' })
		.click();
	await a
		.getByRole('dialog')
		.getByRole('button', { name: 'Delete the channel' })
		.click();
	await expect.poll(() => named('Sprint Talk')).toBeUndefined();

	// At the cap, the form is closed and says why, with the number.
	const have = (await listed()).filter((c) => c.kind === 'text').length;
	await a.evaluate(
		async ([id, count]) => {
			for (let i = 0; i < count; i++)
				await fetch(`/api/crews/${id}/channels`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ kind: 'text', name: `Filler ${i}` }),
				});
		},
		[crew, MaxCrewTextChannels - have] as const,
	);
	await a.reload();
	await expect(
		a.getByRole('textbox', { name: 'new text channel name' }),
	).toBeDisabled();
	await expect(
		a.getByText(
			`A crew holds at most ${MaxCrewTextChannels} chats — delete one to make room.`,
		),
	).toBeVisible();

	// The weekly board's switch, against the crew's own read.
	await a.getByRole('checkbox', { name: 'run the weekly board' }).check();
	await expect
		.poll(() =>
			a.evaluate(
				(id) =>
					fetch(`/api/crews/${id}`)
						.then((res) => res.json())
						.then((body) => body.boardEnabled === true),
				crew,
			),
		)
		.toBe(true);
});
