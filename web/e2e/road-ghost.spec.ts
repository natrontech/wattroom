import type { Page } from '@playwright/test';
import { expect, test } from './crew';
import { signInAs } from './signin';

/**
 * Racing your own ghost (#3615, ADR-0068), on the SimulatedTrainer: a road
 * you have never ridden shows no split and says nothing is wrong; ride it
 * once from its start, and the next ride from the start reads "vs last" on
 * the bike computer's RIDE page.
 *
 * The road is invented, in the open South Atlantic (#3054): 3 km climbing
 * 4 %. Its height moves with the run, so an earlier run's ride of it is
 * never this one's ghost.
 */
function climbGpx(): string {
	const base = 100 + (Date.now() % 1000) / 10;
	const perLon = 111_195 * Math.cos((30 * Math.PI) / 180);
	const points = Array.from({ length: 301 }, (_, i) => {
		const lon = -25 + (i * 10) / perLon;
		return `<trkpt lat="-30.0000000" lon="${lon.toFixed(7)}"><ele>${(base + 0.4 * i).toFixed(1)}</ele></trkpt>`;
	});
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WattRoom e2e" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>A made-up climb</name><trkseg>
${points.join('\n')}
</trkseg></trk>
</gpx>`;
}

/** The saver keeps a ride from a minute (docs/SPEC.md's minute rule). */
const A_MINUTE_MS = 65_000;

async function pairSimulated(page: Page, routeId: string) {
	await page.goto(`/ride?road=${routeId}`);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
}

test('a road ridden once races its ghost from the start', async ({ page }) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(240_000);
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await signInAs(page, 'Road Ghost Rider', '/workouts/import');
	await page.locator('input[type=file]').setInputFiles({
		name: 'climb.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(climbGpx()),
	});
	await page.getByRole('button', { name: 'Save to my routes' }).click();
	await expect(page.getByText(/is on your routes/)).toBeVisible();
	const { routes } = (await (await page.request.get('/api/routes')).json()) as {
		routes: { id: string }[];
	};
	const routeId = routes[0].id;
	const computer = page.getByTestId('bike-computer');
	const split = computer.locator('[data-field=split]');

	// Never ridden: no ghost, no split, and nothing says anything is wrong.
	await pairSimulated(page, routeId);
	await page.getByRole('button', { name: 'Start the ride' }).click();
	// A class IV climb from the first metre: CLIMB opens by itself (#3645),
	// and the split is on RIDE, one page back.
	await expect(computer).toHaveAttribute('data-page', 'climb', {
		timeout: 15_000,
	});
	await computer.getByRole('button', { name: 'RIDE page' }).click();
	await expect(computer.locator('[data-field=distance]')).toBeVisible({
		timeout: 15_000,
	});
	await page.waitForTimeout(A_MINUTE_MS);
	await expect(split).toHaveCount(0);
	await expect(page.getByRole('alert')).toHaveCount(0);
	await page.getByRole('button', { name: /^Save at km / }).click();
	await expect(page.getByText('See your ride')).toBeVisible({
		timeout: 20_000,
	});

	// From the start again: the first ride is the ghost, and the split reads.
	await pairSimulated(page, routeId);
	await page.getByRole('button', { name: 'Whole road' }).click();
	await page.getByRole('button', { name: 'Start the ride' }).click();
	await expect(computer).toHaveAttribute('data-page', 'climb', {
		timeout: 15_000,
	});
	await computer.getByRole('button', { name: 'RIDE page' }).click();
	await expect(split).toBeVisible({ timeout: 15_000 });
	await expect(split).toContainText('vs last');
	// The same simulated watts on the same road is level: "0:00", unsigned.
	await expect(split).toContainText(/[−+]?\d:\d\d/);
});
