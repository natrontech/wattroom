import { expect, test, voicePath } from './crew';
import { RIDE_FRAME } from './scheme';

/**
 * The sidebar on a ride (ADR-0087). The ride's frame covers it (TARGETS G1)
 * and hides the desk's sentences and its typing, but its rows keep their desk
 * sizes: the riding scale (#3770) zoomed the whole app the moment a ride
 * started.
 */
const RIDER = 'Ride Sidebar Rider';

test('the sidebar keeps its desk sizes on a ride', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const page = await riders(RIDER);
	await page.setViewportSize({ width: 1440, height: 900 });
	const opened = await channels.open(page, `Sidebar ${Date.now() % 100000}`);
	const nav = page.locator('nav[aria-label="crews and channels"]');
	const home = nav.getByRole('link', { name: 'Home', exact: true });

	// No session: the Training place is the free ride, on the simulator.
	await page.goto(`${voicePath(opened)}/training`);
	await expect(home).toHaveCSS('font-size', '14px');
	const desk = await home.boundingBox();
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await expect(page.getByRole('button', { name: 'End ride' })).toBeVisible({
		timeout: 30_000,
	});
	// The frame, page and sidebar; the hosts outside it mark their own (#3788).
	await expect(
		page.locator(RIDE_FRAME),
		'the ride never marked the frame',
	).toHaveCount(1);
	await expect(home, 'the sidebar zoomed on a ride').toHaveCSS(
		'font-size',
		'14px',
	);
	expect((await home.boundingBox())?.height).toBe(desk?.height);
	await expect(
		nav.getByRole('button', { name: 'new chat' }),
		'naming a channel is typing, never mid-ride',
	).toBeHidden();

	await page.getByRole('button', { name: 'End ride' }).click();
	await expect(page.locator(RIDE_FRAME)).toHaveCount(0, { timeout: 15_000 });
	await expect(nav.getByRole('button', { name: 'new chat' })).toBeVisible();
});
