import { expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * Turns the world on for every page this page or context loads, muted (AGENTS.md:
 * mute before you play). The one place an e2e spec says "draw the world": the
 * per-device slot flag (#3031) and the World control's Full (#3214) are both
 * set while the slot flag is on its way out, so whichever change lands second
 * edits only this.
 */
export async function worldOn(target: Page | BrowserContext): Promise<void> {
	await target.addInitScript(() => {
		localStorage.setItem('wattroom.world-slot.v1', '1');
		localStorage.setItem('wattroom.world.mode.v1', 'full');
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		);
	});
}

/** The world's canvas: docked behind the panels on a desk or a TV, a band in a phone's column (#3676). */
export const WORLD = '[data-surface=docked] canvas, [data-dock=world] canvas';

/**
 * Waits for the world to draw: its canvas sized off the 300 px default.
 * Building a world holds a loaded runner's main thread a while.
 */
export async function drawing(page: Page): Promise<void> {
	await page.waitForFunction(
		(world) => {
			const canvas = document.querySelector<HTMLCanvasElement>(world);
			return !!canvas && canvas.width !== 300;
		},
		WORLD,
		{ polling: 100, timeout: 60_000 },
	);
}

/**
 * Still riding the road, in the world or on the Skyline the world handed it
 * to for missed frames — which software GL does seconds in (#3877), and which
 * is the app judging right. Any other reason is a failure. `stop` is the
 * ride's own way out: End ride alone, Leave the ride in a session.
 */
export async function onTheRoad(page: Page, stop = 'End ride'): Promise<void> {
	await expect(page.getByRole('button', { name: stop })).toBeVisible();
	const flat = page.getByTestId('flat-road');
	if (await flat.count()) await expect(flat).toHaveText(/dropped frames/);
	else await expect(page.locator(WORLD)).toBeVisible();
}

/** The rider's newest ride, as their list has it. */
export async function latestRide(page: Page) {
	return page.evaluate(async () => {
		const res = await fetch('/api/rides');
		const { rides } = (await res.json()) as {
			rides: {
				id: string;
				distanceM?: number;
				climbedM?: number;
				road?: { routeId: string };
			}[];
		};
		return rides[0];
	});
}
