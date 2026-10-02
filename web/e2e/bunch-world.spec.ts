import type { Page } from '@playwright/test';
import { expect, test, voicePath } from './crew';
import { climbGpx } from './road-gpx';

/**
 * The bunch in the world (#3098, ADR-0065): two riders in one session on a
 * road, each with the world on, and each screen draws both of them where the
 * other screen does — within a metre along the road and across it. What
 * either screen draws came through the hub: one bunch position, each rider's
 * offset, and the order they joined in, laid out the same way twice.
 * Behind the roads dev gate, which a dev server opens.
 */
const COUNTDOWN_MS = 10_000;
const SETTLE_MS = 30_000;

type Drawn = { id: string; d: number; lane: number };

/** Where this screen's world drew everyone, as its canvas says (RideWorld). */
const drawn = (page: Page) =>
	page.evaluate(() => {
		const said = document.querySelector<HTMLCanvasElement>(
			'canvas[data-riders]',
		)?.dataset.riders;
		return said ? (JSON.parse(said) as Drawn[]) : [];
	});

test('two screens draw one bunch: each rider where the other screen has them', async ({
	riders,
	channels,
}, info) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(240_000);
	const coach = await riders('Bunch World Coach');
	const guest = await riders('Bunch World Guest');
	const said: string[] = [];
	for (const page of [coach, guest]) {
		await page
			.context()
			.addInitScript(() => localStorage.setItem('wattroom.world-slot.v1', '1'));
		// A world that falls back says why in the console; a red run carries it.
		page.on('console', (m) => said.push(`${m.type()}: ${m.text()}`));
	}
	const idOf = (page: Page) =>
		page.evaluate(
			async () =>
				((await (await fetch('/api/me')).json()) as { id: string }).id,
		);
	const [coachId, guestId] = [await idOf(coach), await idOf(guest)];

	const NAME = `Bunch road ${Date.now() % 100000}`;
	await coach.goto('/workouts/import');
	await coach.locator('input[type=file]').setInputFiles({
		name: 'climb.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(climbGpx()),
	});
	await coach.getByLabel('your name for it').fill(NAME);
	await coach.getByRole('button', { name: 'Save to my routes' }).click();
	await expect(coach.getByText(`“${NAME}” is on your routes`)).toBeVisible();

	const opened = await channels.open(coach, `Bunch ${Date.now() % 100000}`);
	await channels.enter(guest, opened);
	for (const page of [coach, guest]) {
		await page.goto(`${voicePath(opened)}/training`);
		await page
			.getByRole('button', { name: 'Ride simulated' })
			.click({ timeout: 15_000 });
	}
	await coach
		.getByRole('button', { name: 'Start a session' })
		.click({ timeout: 15_000 });
	const picker = coach.getByRole('dialog', { name: 'Start a session' });
	await picker.getByRole('button', { name: 'Roads' }).click();
	await picker
		.getByRole('list', { name: 'your routes' })
		.getByRole('button', { name: new RegExp(NAME) })
		.click();
	await picker.getByRole('button', { name: /^Start Road/ }).click();
	await guest
		.getByRole('link', { name: 'Join the ride' })
		.click({ timeout: COUNTDOWN_MS + SETTLE_MS });

	try {
		// Read both screens at once: the bunch rolls on between the two reads,
		// so compare where each screen has the guest against the coach, and
		// each rider's lane.
		await expect
			.poll(
				async () => {
					const [a, b] = await Promise.all([drawn(coach), drawn(guest)]);
					const pick = (list: Drawn[], id: string) =>
						list.find((r) => r.id === id);
					const views = [a, b].map((list) => ({
						coach: pick(list, coachId),
						guest: pick(list, guestId),
					}));
					if (views.some((v) => !v.coach || !v.guest))
						return `not both drawn yet: ${JSON.stringify([a, b])}`;
					const [onCoach, onGuest] = views as {
						coach: Drawn;
						guest: Drawn;
					}[];
					const gap = (v: { coach: Drawn; guest: Drawn }) =>
						v.guest.d - v.coach.d;
					const off = Math.max(
						Math.abs(gap(onCoach) - gap(onGuest)),
						Math.abs(onCoach.coach.lane - onGuest.coach.lane),
						Math.abs(onCoach.guest.lane - onGuest.guest.lane),
					);
					// Two riders ride abreast: on two lanes, never one.
					const abreast = Math.abs(onCoach.coach.lane - onCoach.guest.lane);
					return off <= 1 && abreast > 0.5
						? 'one bunch'
						: `screens differ by ${off.toFixed(2)} m (coach ${coachId}, guest ${guestId}): ${JSON.stringify([a, b])}`;
				},
				{
					message: 'each screen should draw both riders where the other does',
					timeout: COUNTDOWN_MS + SETTLE_MS,
					intervals: [500],
				},
			)
			.toBe('one bunch');
	} finally {
		await info.attach('console', { body: said.join('\n') });
	}
});
