import type { Page } from '@playwright/test';
import { expect, test, textPath, voicePath } from './crew';

/**
 * A rider picks their own reactions in Settings (#2722 — the crew's until
 * then), and every voice and text channel offers exactly those (#2521).
 */

/** This spec's own rider — nobody else's (#2133). */
const A = 'Rider Cheers Owner';

/** The rider's set, through the same write Settings makes; [] is the stock set. */
function setCheers(page: Page, cheers: string[]) {
	return page.evaluate(async (cheers) => {
		const res = await fetch('/api/me/cheers', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ cheers }),
		});
		return res.status;
	}, cheers);
}

const PALETTE = ['rocket', 'snowflake', 'skull', 'trophy'];

test("a voice channel offers the rider's reactions", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Rider Cheers ${Date.now() % 100000}`);

	try {
		expect(await setCheers(a, PALETTE), 'saving the set').toBe(200);
		await a.goto(voicePath(opened));
		for (const cheer of PALETTE)
			await expect(
				a.getByRole('button', { name: cheer, exact: true }),
			).toBeVisible({
				timeout: 15_000,
			});
		// The stock set's own, which this palette leaves out.
		await expect(
			a.getByRole('button', { name: 'party-popper', exact: true }),
		).toHaveCount(0);
	} finally {
		// The rider outlives the run: back to the stock set.
		await setCheers(a, []);
	}
});

test("a text channel's reaction picker leads with the rider's set", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Rider Picks ${Date.now() % 100000}`);

	try {
		// An emoji in the set is a reaction of its own (#2643).
		expect(await setCheers(a, ['trophy', '🥵'])).toBe(200);
		await a.goto(textPath(opened));
		const draft = a.getByPlaceholder(/^Message /);
		await draft.fill('who is in tonight');
		await draft.press('Enter');
		const line = a.getByTestId('thread-message').last();
		await line.hover();
		await line.getByRole('button', { name: 'react' }).click();
		const picker = a.getByRole('dialog', { name: 'Pick an emoji' });
		// The text channel once drew the stock set whatever was chosen — the
		// voice channel's #2521, one surface over.
		await expect(
			picker.getByRole('button', { name: 'trophy', exact: true }),
		).toBeVisible();
		await expect(
			picker.getByRole('button', { name: 'party-popper', exact: true }),
		).toHaveCount(0);
		await picker.getByRole('button', { name: '🥵', exact: true }).click();
		await expect(
			line.getByRole('button', { name: '🥵 1', exact: true }),
		).toHaveAttribute('aria-pressed', 'true');
	} finally {
		await setCheers(a, []);
	}
});

test("a voice channel cheers with the crew's own emoji from the picker", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Crew Emoji ${Date.now() % 100000}`);
	// 409: the rider's crew outlives the run and already has it.
	const uploaded = await a.evaluate(async (crew) => {
		const png = Uint8Array.from(
			atob(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			),
			(c) => c.charCodeAt(0),
		);
		const res = await fetch(`/api/crews/${crew}/emoji?name=cheer_dot`, {
			method: 'POST',
			headers: { 'content-type': 'image/png' },
			body: png,
		});
		return res.status;
	}, opened.crew);
	expect([201, 409]).toContain(uploaded);

	await a.goto(voicePath(opened));
	// Not in the four: the stock set is all icons (#2692).
	await a
		.getByRole('button', { name: 'More reactions', exact: true })
		.click({ timeout: 15_000 });
	const picker = a.getByRole('dialog', { name: 'Pick an emoji' });
	await picker
		.getByRole('button', { name: ':cheer_dot:', exact: true })
		.click();
	await expect(picker).toHaveCount(0);
	// It lands as a cheer, drawn as the crew's picture.
	await expect(a.locator('.cheer img[src*="/emoji/"]')).toBeVisible();
});
