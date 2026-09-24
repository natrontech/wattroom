import { expect, test, voicePath, type OpenedChannels } from './crew';
import type { Page } from '@playwright/test';

/**
 * A click on a voice channel in the sidebar is the tap that joins its voice,
 * and a switch carries the mic and a live camera along (#2702). Every other
 * way onto the page still connects nothing (ADR-0010's #681 amendment).
 */
// A name per test: the two run in parallel, and one name is one account —
// its crew, and its mic claim across tabs (#293), shared between them.
const A = 'Click Joiner';
const F = 'Fold Opener';
const B = 'Fold Neighbour';

const rowOf = (page: Page, opened: OpenedChannels) =>
	page
		.getByRole('navigation', { name: 'crews and channels' })
		.locator(`a[href="${voicePath(opened)}"]`);

test('a sidebar click joins voice, and a switch keeps the camera', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider and make infra only exist against a local dev server',
	);
	test.setTimeout(90_000);

	const a = await riders(A);
	await a.setViewportSize({ width: 1440, height: 900 });
	await a.context().grantPermissions(['microphone', 'camera']);
	const n = Date.now() % 100000;
	const one = await channels.open(a, `Click One ${n}`);
	const two = await channels.open(a, `Click Two ${n}`);

	const join = a.getByRole('button', { name: 'Join voice' });
	const mic = a.getByRole('button', { name: 'microphone' });
	const cam = a.getByRole('button', { name: 'camera', exact: true });

	// Arriving by address connects nothing.
	await expect(join, 'a typed address joined voice').toBeVisible({
		timeout: 15_000,
	});

	await rowOf(a, one).click();
	await a.waitForURL(`**${voicePath(one)}`);
	await expect(mic, 'the click did not join voice').toHaveAttribute(
		'aria-pressed',
		'true',
		{ timeout: 20_000 },
	);

	await cam.click();
	await expect(cam).toHaveAttribute('aria-pressed', 'true', {
		timeout: 15_000,
	});
	await mic.click();
	await expect(mic).toHaveAttribute('aria-pressed', 'false');

	await rowOf(a, two).click();
	await a.waitForURL(`**${voicePath(two)}`);
	await expect(cam, 'the camera did not follow the switch').toHaveAttribute(
		'aria-pressed',
		'true',
		{ timeout: 20_000 },
	);
	await expect(mic, 'the switch unmuted the mic').toHaveAttribute(
		'aria-pressed',
		'false',
	);

	await cam.click();
	await expect(cam).toHaveAttribute('aria-pressed', 'false');
	await rowOf(a, one).click();
	await a.waitForURL(`**${voicePath(one)}`);
	await expect(mic).toBeVisible({ timeout: 20_000 });
	await expect(cam, 'a camera that was off came on').toHaveAttribute(
		'aria-pressed',
		'false',
	);

	// Leaving by address is a plain arrival again: no voice.
	await a.goto(voicePath(two));
	await expect(join, 'an address carried the call along').toBeVisible({
		timeout: 15_000,
	});
});

test('one voice channel at a time lists who is in it', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(F);
	await a.setViewportSize({ width: 1440, height: 900 });
	const n = Date.now() % 100000;
	const one = await channels.open(a, `Fold One ${n}`);
	const two = await channels.open(a, `Fold Two ${n}`);
	const b = await riders(B);
	await channels.enter(b, one);
	// A stands in Two, B in One: both rows have somebody to list.

	const arrowOne = a.getByRole('button', {
		name: `Show who is in ${one.name}`,
	});
	const arrowTwo = a.getByRole('button', {
		name: `Show who is in ${two.name}`,
	});
	const listOne = a.getByRole('list', { name: `Who is in ${one.name}` });
	const listTwo = a.getByRole('list', { name: `Who is in ${two.name}` });

	await arrowOne.click({ timeout: 15_000 });
	await expect(listOne).toContainText(B);
	await expect(a, 'the arrow navigated').toHaveURL(
		new RegExp(`${voicePath(two)}$`),
	);
	await expect(a.getByRole('button', { name: 'Join voice' })).toBeVisible();

	await arrowTwo.click();
	await expect(listTwo).toContainText(F);
	await expect(listOne, 'two channels were open at once').toHaveCount(0);

	await a.getByRole('button', { name: `Hide who is in ${two.name}` }).click();
	await expect(listTwo).toHaveCount(0);
});
