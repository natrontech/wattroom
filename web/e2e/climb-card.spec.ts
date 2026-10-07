import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './signin';
import { climbGpx } from './road-gpx';

/**
 * The climb card (#3645, ADR-0071): a road's classed climb opens CLIMB by
 * itself and says so, and a rider who pages away is told where it is. The
 * invented road (route-ride.spec.ts) is 3 km at 4 %: a class IV climb from
 * its first metre. The mixer is at zero, so the cues are read from the
 * engine's own log line.
 */
async function rideTheClimb(page: Page, name: string, cues: string[]) {
	page.on('console', (message) => {
		const text = message.text();
		if (text.startsWith('[cue]')) cues.push(text.slice(6).trim());
	});
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await signInAs(page, name, '/workouts/import');
	await page.locator('input[type=file]').setInputFiles({
		name: 'climb.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(climbGpx()),
	});
	await page.getByRole('button', { name: 'Ride it now' }).click();
	await page.waitForURL(/\/ride\?road=/);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start riding' }).click();
	const computer = page.getByTestId('bike-computer');
	await expect(computer).toHaveAttribute('data-page', 'climb', {
		timeout: 15_000,
	});
	return computer;
}

test.describe('the climb card', () => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	test('opens by itself on a climb, says so, and is named from another page', async ({
		page,
	}) => {
		const cues: string[] = [];
		const computer = await rideTheClimb(page, 'Climb Card Rider', cues);
		await expect(computer.getByText('CLIMB 1 OF 1')).toBeVisible();
		await expect(computer.getByTestId('climb-class')).toHaveText('IV');
		for (const key of ['toTop', 'ascentLeft', 'avgLeft'])
			await expect(computer.locator(`[data-field=${key}]`)).toBeVisible();
		await expect(computer.getByTestId('climb-profile')).toBeVisible();
		await expect(computer.getByTestId('climb-dot')).toBeVisible();
		await expect.poll(() => cues).toContain('climb');

		// Paged away: the page stays yours, and a chip names the climb.
		await page.keyboard.press('ArrowRight');
		await expect(computer).toHaveAttribute('data-page', 'power');
		await expect(computer.getByTestId('climb-chip')).toHaveText('climb IV');
		await page.keyboard.press('ArrowLeft');
		await expect(computer).toHaveAttribute('data-page', 'climb');
		await expect(computer.getByTestId('climb-chip')).toHaveCount(0);
	});
});

test.describe('the climb card in forced colours', () => {
	test.use({ forcedColors: 'active' });
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	test('keeps its profile and your dot drawn', async ({ page }) => {
		const computer = await rideTheClimb(page, 'Forced Climb Rider', []);
		const profile = computer.getByTestId('climb-profile');
		await expect(profile).toBeVisible();
		const drawn = await profile.evaluate((el) => {
			const probe = document.createElement('div');
			probe.style.cssText =
				'background-color: Canvas; forced-color-adjust: none';
			document.body.append(probe);
			const canvas = getComputedStyle(probe).backgroundColor;
			probe.remove();
			const painted = (colour: string) => {
				const [r, g, b, a = 1] = (colour.match(/[\d.]+/g) ?? []).map(Number);
				return a > 0 && `rgb(${r}, ${g}, ${b})` !== canvas;
			};
			const bar = el.querySelector('span:not([data-testid])')!;
			const dot = el.querySelector('[data-testid=climb-dot]')!;
			return {
				bar: painted(getComputedStyle(bar).backgroundColor),
				dot: painted(getComputedStyle(dot).backgroundColor),
			};
		});
		expect(drawn).toEqual({ bar: true, dot: true });
	});
});
