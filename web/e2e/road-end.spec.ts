import type { Page } from '@playwright/test';
import { expect, test } from './crew';
import { signInAs } from './signin';

/**
 * A solo route ride never dead-ends (#3205), on the SimulatedTrainer: stop
 * early and it saves at its kilometre; the next start offers to carry on from
 * there; ride to the end and the sheet rides you back the way you came after
 * its 10 s, in the same ride, which saves once with both laps.
 *
 * The road is invented, in the open South Atlantic (#3054): 2.2 km down 8 %,
 * so a minute's riding stops partway and the next reaches the end. Its height
 * moves with the run, so an earlier run's rides of it are never this one's.
 */
function descentGpx(): string {
	const top = 400 + (Date.now() % 1000) / 10;
	const perLon = 111_195 * Math.cos((30 * Math.PI) / 180);
	const points = Array.from({ length: 221 }, (_, i) => {
		const lon = -25 + (i * 10) / perLon;
		return `<trkpt lat="-30.0000000" lon="${lon.toFixed(7)}"><ele>${(top - 0.8 * i).toFixed(1)}</ele></trkpt>`;
	});
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WattRoom e2e" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>A made-up descent</name><trkseg>
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

async function attempts(page: Page, routeId: string) {
	return page.evaluate(async (id) => {
		const res = await fetch(`/api/routes/${id}/attempts`);
		const { attempts } = (await res.json()) as {
			attempts: { fromM?: number; distanceM?: number }[];
		};
		return attempts;
	}, routeId);
}

test('a solo route ride saves at its kilometre, carries on, and rides back from the end', async ({
	page,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(300_000);
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await signInAs(page, 'Road End Rider', '/workouts/import');
	await page.locator('input[type=file]').setInputFiles({
		name: 'descent.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(descentGpx()),
	});
	await page.getByRole('button', { name: 'Save to my routes' }).click();
	await expect(page.getByText(/is on your routes/)).toBeVisible();
	const { routes } = (await (await page.request.get('/api/routes')).json()) as {
		routes: { id: string }[];
	};
	const routeId = routes[0].id;

	// A minute, then stop short: End ride saves where you are.
	await pairSimulated(page, routeId);
	await page.getByRole('button', { name: 'Start riding' }).click();
	await page.waitForTimeout(A_MINUTE_MS);
	await page.getByRole('button', { name: /^Save at km / }).click();
	await expect(page.getByText('See it in your history')).toBeVisible({
		timeout: 20_000,
	});
	const [first] = await attempts(page, routeId);
	const stopped = (first.fromM ?? 0) + first.distanceM!;
	expect(stopped, 'the first ride reached the end').toBeLessThan(2150);

	// The next start carries on from there, beside From the start.
	await pairSimulated(page, routeId);
	const carry = page.getByRole('button', { name: /^Carry on from km / });
	await expect(carry).toHaveText(
		`Carry on from km ${(stopped / 1000).toFixed(1)}`,
	);
	await expect(
		page.getByRole('button', { name: 'From the start' }),
	).toBeVisible();
	await carry.click();

	// Down to the end: the sheet, and Ride back after its 10 s.
	const sheet = page.getByRole('region', { name: 'the end of the road' });
	await expect(sheet).toBeVisible({ timeout: 90_000 });
	await page.setViewportSize({ width: 375, height: 812 });
	for (const name of [
		'Ride back the way you came',
		'Ride it again',
		'Save the ride',
	]) {
		const box = await sheet.getByRole('button', { name }).boundingBox();
		expect(box!.height, `${name} is under 44 px`).toBeGreaterThanOrEqual(44);
	}
	await expect
		.poll(() =>
			page
				.getByTestId('page-body')
				.evaluate((el) => el.scrollWidth - el.clientWidth),
		)
		.toBe(0);
	await expect(sheet).toHaveCount(0, { timeout: 15_000 });
	const km = async () =>
		Number((await page.getByText(/ of 2\.2 km$/).textContent())?.split(' ')[0]);
	// Back up 8 % is slow, and the readout is to 100 m.
	await expect
		.poll(km, { message: 'the dot did not turn back', timeout: 60_000 })
		.toBeLessThan(2.2);
	// The Skyline looks ahead on the way back too (#3059): it draws the
	// road as this lap rides it, so its metres grow though the stored
	// road's count down.
	const skyline = page.getByTestId('skyline');
	const along = async () => Number(await skyline.getAttribute('data-along'));
	const back = await along();
	await expect
		.poll(along, { message: 'the Skyline ran backwards', timeout: 15_000 })
		.toBeGreaterThan(back);

	await page.getByRole('button', { name: 'End ride' }).click();
	await expect(page.getByText('See it in your history')).toBeVisible({
		timeout: 20_000,
	});
	const [second, ...rest] = await attempts(page, routeId);
	expect(rest, 'the ride saved more than once').toHaveLength(1);
	expect(
		Math.abs(second.fromM! - stopped),
		'carry on started away from where the last ride stopped',
	).toBeLessThanOrEqual(25);
	// Down to the end and some way back up: one ride, both laps.
	expect(second.distanceM!).toBeGreaterThan(2200 - second.fromM!);
});
