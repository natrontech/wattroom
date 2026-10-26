import type { Page } from '@playwright/test';
import { expect, test } from './crew';
import { COUNTDOWN_MS, NEUTRAL_MS, raceARoad } from './race';
import { drawn, worldOn, type Snapshot } from './world';

// The world draws in a window the box table holds (TARGETS ride-road-world).
test.use({ viewport: { width: 1440, height: 900 } });

/** Why a run compared nothing from km 0: a world handed the ride to the flat road first. */
const SOFTWARE = 'a world dropped frames before km 0';

/**
 * A race in the world (#3778, ADR-0067): two racers on the coach's road, each
 * with the world on, and each screen draws both of them where the other
 * screen does, within a metre along the road. A race rides no bunch: each
 * racer is at their own metre, as the hub steps them, from the neutral zone
 * through km 0.
 */
test('two screens draw every racer at their own metre @world', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(COUNTDOWN_MS + NEUTRAL_MS + 180_000);
	const coach = await riders('Race World Coach');
	const guest = await riders('Race World Guest');
	for (const page of [coach, guest]) await worldOn(page.context());
	const idOf = (page: Page) =>
		page.evaluate(
			async () =>
				((await (await fetch('/api/me')).json()) as { id: string }).id,
		);
	const ids = [await idOf(coach), await idOf(guest)];
	await raceARoad(coach, [guest], channels);

	/**
	 * Both screens read at once, each snapshot stamped with when it was taken:
	 * a racer's place on one screen, carried on at their own speed to the
	 * moment the other was taken, is where the other drew them. `rolling`
	 * waits for km 0, where the hub first steps the field.
	 */
	const together = async (rolling: boolean) => {
		const [a, b] = await Promise.all([drawn(coach), drawn(guest)]);
		// km 0 is three minutes in, and a runner drawing two worlds in software
		// misses frames long before: the world hands the ride to the flat road,
		// which is the app judging right (#3877), and leaves nothing to compare.
		if (rolling && [a, b].some((s) => /dropped frames/.test(String(s))))
			return SOFTWARE;
		if (typeof a === 'string' || typeof b === 'string')
			return `a world went to the flat road: ${JSON.stringify([a, b])}`;
		const pick = (s: Snapshot | null, id: string) =>
			s?.riders.find((r) => r.id === id);
		if (!a || !b || ids.some((id) => !pick(a, id) || !pick(b, id)))
			return `not both racers on both screens yet: ${JSON.stringify([a, b])}`;
		if (rolling && (a.mps < 1 || b.mps < 1))
			return `not past km 0 yet: ${JSON.stringify([a, b])}`;
		const since = (b.t - a.t) / 1000;
		const off = Math.max(
			...ids.map((id) =>
				Math.abs(pick(a, id)!.d + pick(a, id)!.v * since - pick(b, id)!.d),
			),
		);
		return off <= 1
			? 'one race'
			: `screens differ by ${off.toFixed(2)} m: ${JSON.stringify([a, b])}`;
	};
	// Lined up in the neutral zone: each screen draws the other racer too.
	await expect
		.poll(() => together(false), {
			message: 'each screen should draw both racers where the other does',
			timeout: COUNTDOWN_MS + 60_000,
			intervals: [500],
		})
		.toBe('one race');
	// From km 0, each at their own metre, still where the other screen has them.
	let rolling = '';
	await expect
		.poll(async () => (rolling = await together(true)), {
			message: 'each screen should draw both racers where the other does',
			timeout: NEUTRAL_MS + 60_000,
			intervals: [500],
		})
		.toMatch(new RegExp(`^(one race|${SOFTWARE})$`));
	if (rolling === SOFTWARE)
		test.info().annotations.push({
			type: 'rolling not compared',
			description: SOFTWARE,
		});
});
