import type { WebSocketRoute } from '@playwright/test';
import { expect, test, voicePath } from './crew';
import { climbGpx } from './road-gpx';

/**
 * The RACE page and the team-car radio (#3174): two riders race the coach's
 * road on simulated trainers. Through the neutral zone the page has no par
 * yet and the radio calls it; from km 0 the page reads the gap to par, the
 * rider's place in their Category and W/kg, and the radio says the race is
 * on. No screen starts a race yet, so the coach's socket sends the start the
 * hub takes from a client (ADR-0067: a race opens its own session on a road).
 */
const COUNTDOWN_MS = 10_000;
const NEUTRAL_MS = 180_000;

test('a race shows its RACE page and calls it on the team-car radio', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(COUNTDOWN_MS + NEUTRAL_MS + 180_000);
	const coach = await riders('Race Page Coach');
	const guest = await riders('Race Page Guest');

	const NAME = `Race road ${Date.now() % 100000}`;
	await coach.goto('/workouts/import');
	await coach.locator('input[type=file]').setInputFiles({
		name: 'climb.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(climbGpx()),
	});
	await coach.getByLabel('your name for it').fill(NAME);
	await coach.getByRole('button', { name: 'Save to my routes' }).click();
	await expect(coach.getByText(`“${NAME}” is on your routes`)).toBeVisible();
	const routeId = await coach.evaluate(async (name) => {
		const { routes } = (await (await fetch('/api/routes')).json()) as {
			routes: { id: string; name: string }[];
		};
		return routes.find((r) => r.name === name)?.id ?? '';
	}, NAME);
	expect(routeId, 'the imported road is on the coach’s routes').toBeTruthy();

	const opened = await channels.open(coach, `Race ${Date.now() % 100000}`);
	await channels.enter(guest, opened);
	let socket: WebSocketRoute | undefined;
	await coach.routeWebSocket(/\/ws\/channels\//, (ws) => {
		socket = ws.connectToServer();
	});
	for (const page of [coach, guest]) {
		await page.goto(`${voicePath(opened)}/training`);
		await page
			.getByRole('button', { name: 'Ride simulated' })
			.click({ timeout: 15_000 });
	}
	// Sent until the session opens: a page that reconnected has a new socket.
	const start = JSON.stringify({
		control: { action: 'game', gameMode: 'race', route: { id: routeId } },
	});
	const open = coach.getByRole('button', { name: 'end the session' });
	for (let k = 0; k < 5 && !(await open.count()); k++) {
		socket?.send(start);
		await open.waitFor({ timeout: 4000 }).catch(() => {});
	}
	await expect(open).toBeVisible();
	// The field freezes at the flag, so the guest lines up in the countdown.
	await guest
		.getByRole('link', { name: 'Join the ride' })
		.click({ timeout: COUNTDOWN_MS });
	// The race opened at its own address; the picker would have followed it.
	await coach
		.getByRole('link', { name: 'Go to the ride' })
		.click({ timeout: COUNTDOWN_MS });

	for (const page of [coach, guest]) {
		// Under way: the flag has dropped and the radio has made its first call.
		await expect(page.getByTestId('race-radio')).toBeVisible({
			timeout: COUNTDOWN_MS + 30_000,
		});
		await page.getByRole('button', { name: 'RACE page', exact: true }).click();
		await expect(page.getByTestId('bike-computer')).toHaveAttribute(
			'data-page',
			'race',
		);
	}
	const par = coach.locator('[data-field="par"]');
	const radio = coach.getByTestId('race-radio');
	// The neutral zone: no par to measure yet, and the radio says where it is.
	await expect(par).toContainText('—');
	await expect(radio).toContainText('Neutral zone.');

	// From km 0: the gap to par, a place among two, W/kg — and the call.
	await expect(par).toContainText(/[+−]\d+:\d\d/, {
		timeout: NEUTRAL_MS + 30_000,
	});
	await expect(coach.locator('[data-field="place"]')).toContainText(
		/in [A-D]\s*(1st|2nd) of 2/,
	);
	await expect(coach.locator('[data-field="wkg"]')).toContainText(/\d\.\d/);
	await expect(radio).toContainText(/km 0\. Race on\.|to the line\./, {
		timeout: 30_000,
	});
});
