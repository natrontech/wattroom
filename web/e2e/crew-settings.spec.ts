import { MaxCrewTextChannels } from '../src/lib/protocol';
import { expect, test } from './room';

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
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const room = await rooms.open(a, `Crew Settings ${Date.now() % 100000}`);
	const channels = () =>
		a.evaluate(
			(id) =>
				fetch(`/api/crews/${id}/channels`)
					.then((res) => res.json())
					.then((body: { channels: Row[] }) => body.channels),
			room.crew,
		);
	const named = async (name: string) =>
		(await channels()).find((c) => c.name === name);

	await a.goto(`/crew/${room.crew}/settings`);
	await a
		.getByRole('textbox', { name: 'new text channel name' })
		.fill('Sprints');
	await a
		.getByRole('textbox', { name: 'new text channel name' })
		.press('Enter');
	await expect.poll(() => named('Sprints')).toMatchObject({ kind: 'text' });

	// Open the row; its name saves on change.
	await a.getByText('Sprints', { exact: true }).click();
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
	const have = (await channels()).filter((c) => c.kind === 'text').length;
	await a.evaluate(
		async ([id, count]) => {
			for (let i = 0; i < count; i++)
				await fetch(`/api/crews/${id}/channels`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ kind: 'text', name: `Filler ${i}` }),
				});
		},
		[room.crew, MaxCrewTextChannels - have] as const,
	);
	await a.reload();
	await expect(
		a.getByRole('textbox', { name: 'new text channel name' }),
	).toBeDisabled();
	await expect(
		a.getByText(
			`A crew holds at most ${MaxCrewTextChannels} text channels — delete one to make room.`,
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
						.then((crew) => crew.boardEnabled === true),
				room.crew,
			),
		)
		.toBe(true);
});
