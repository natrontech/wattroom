import { test, type Page, type WebSocketRoute } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	ROADS,
	bigWatts,
	designCrew,
	fixtureRoad,
	newestRide,
	readRoad,
	savedRide,
	voicePath,
} from './design/seed';
import { homeProbe } from './design/home-probe';
import {
	endSession,
	joinSession,
	pickRoad,
	press,
	startSession,
	toTraining,
} from './design/session';
import {
	DESK,
	DESK_720,
	HUD_SHELL,
	OUT,
	PHONE,
	RIDE_SECOND,
	RIDING_PHONE,
	SCHEMES,
	Shoot,
	TV,
	assertRiding,
	atReading,
	atRoundSecond,
	atSecond,
	ride,
	takes,
	variants,
	wanted,
	RELEASE_FEED,
	type Opened,
} from './design/shoot';
import { hudScale } from './design/probe';
import { holdCountIn } from './hold-count-in';

/**
 * The design shots (#3666, docs/design/DESIGN-CHECK.md): every surface in
 * docs/design/TARGETS.md whose route exists today, shot the way its section's
 * Capture line says, with the probes beside each image. `make design-shots`
 * builds this checkout, serves it on a fresh database, seeds it
 * (design-seed.spec.ts) and runs this; without DESIGN_SHOTS_OUT it skips.
 *
 * It rides as the dev rider Designer. The mixer is zeroed in every context and
 * the browser is muted. LiveKit is shared: the session surfaces join a voice
 * channel on it.
 *
 * One worker takes every surface that signs in as Designer, in file order:
 * they share the rider's presence, crew and rides, and the sidebar shows all
 * three. The rides that save come last, so every surface before them sees the
 * seed and nothing else, whichever surfaces a run names (#3858). The `alone`
 * blocks share nothing with them and run beside them on other workers.
 *
 * A surface whose route is still to come is a `test.fixme` naming the issue
 * that brings it, so it shows in the list and its issue turns it on.
 */

test.skip(!OUT, 'the design shots run through `make design-shots`');

/**
 * One test per surface and scheme; `take` gets a Shoot that cleans up after
 * it. `also`: the other TARGETS.md ids its shots carry (`#### workouts,
 * phone-workouts`), so naming any of them takes it. `once`: shot in the run's
 * first scheme only — a riding surface's layout is the same in either scheme
 * (G1; ride-free-road and ride-countin fix the OS to light to show it keeps
 * the rider's), TV mode and the HUD are dark in both, and a poster is an
 * image.
 */
function surface(
	id: string,
	take: (s: Shoot) => Promise<void>,
	{ also = [], once = false }: { also?: string[]; once?: boolean } = {},
) {
	for (const scheme of once ? SCHEMES.slice(0, 1) : SCHEMES)
		test(`${id} (${scheme})`, async ({ browser }) => {
			test.skip(!wanted([id, ...also]), 'not in DESIGN_SHOTS_SURFACES');
			const s = new Shoot(browser, id, scheme);
			await s.clean();
			try {
				await take(s);
			} catch (error) {
				await s.failed(error);
				throw error;
			} finally {
				await s.close();
			}
		});
}

/** Surfaces that share nothing with Designer's, on workers of their own. */
function alone(register: () => void) {
	test.describe(() => {
		test.describe.configure({ mode: 'parallel' });
		register();
	});
}

/**
 * A page shot whole, after it has settled. `measure`: a surface's own probes,
 * each under its key in the shot's JSON, taken at the window's size before
 * the shot grows it.
 */
async function page(
	s: Shoot,
	opened: Opened,
	path: string,
	{
		name,
		settle = 2500,
		measure,
	}: {
		name?: string;
		settle?: number;
		measure?: Record<string, () => unknown>;
	} = {},
) {
	await opened.page.goto(path);
	await opened.page.waitForTimeout(settle);
	const extra: Record<string, unknown> = {};
	for (const [key, probe] of Object.entries(measure ?? {}))
		extra[key] = await opened.page.evaluate(probe);
	await s.shot(opened, { name, full: true, extra });
}

// ─── A. Riding surfaces ──────────────────────────────────────────────────

surface(
	'ride-road-world',
	async (s) => {
		for (const [device, name] of variants([
			[DESK, 'ride-road-world'],
			[DESK_720, 'ride-road-world-1280'],
			[TV, 'ride-road-world-tv'],
		] as const)) {
			const o = await s.open(device, { world: true });
			const road = await fixtureRoad(o.page, 'hairpin');
			await ride(o.page, `/ride?w=openers&road=${road}&from=0`);
			// 1280 × 720 is shorter than the box table holds: it rides the flat
			// road and says why (Jan, 2026-10-07, #3668).
			await assertRiding(o.page, device !== DESK_720);
			// Item 16's distance, however long the road takes to get there (#3834).
			await atReading(o.page, 'km 0.1 of 7.1');
			await s.shot(o, { name });
			// multi:world-drift — four frames a quarter-second apart as you ride
			// on: the road's grain holds to the road, and the field of view (#3674).
			if (device === DESK)
				for (let k = 1; k <= 4; k++) {
					await o.page.waitForTimeout(250);
					await s.shot(o, { name: `world-drift-${k}` });
				}
			// multi:world-60s — the next minute of the same ride, a frame every
			// 5 s: the forest beside the road as the rider passes it (#3675).
			if (device === DESK)
				for (let k = 1; k <= 12; k++) {
					await o.page.waitForTimeout(5000);
					await s.shot(o, {
						name: `world-60s-${String(k).padStart(2, '0')}`,
					});
				}
			await o.ctx.close();
		}
		// multi:world-hairpins — item 16's second leg, from km 2.3: the hairpins climb ahead.
		const o = await s.open(DESK, { world: true });
		const road = await fixtureRoad(o.page, 'hairpin');
		await ride(o.page, `/ride?w=openers&road=${road}&from=2300`);
		await assertRiding(o.page, true);
		await s.shot(o, { name: 'world-hairpins' });
		// multi:ride-keys-sheet and multi:ride-keys-clean — the ? sheet over the
		// ride, then H's clean view (#3216).
		await o.page.keyboard.press('?');
		await o.page.getByTestId('key-sheet').waitFor();
		await s.shot(o, { name: 'ride-keys-sheet' });
		await o.page.keyboard.press('Escape');
		await o.page.keyboard.press('h');
		await o.page.locator('[data-dock=header]').waitFor({ state: 'detached' });
		await s.shot(o, { name: 'ride-keys-clean' });
		await o.page.keyboard.press('h');

		// multi:ride-road-world-climb — item 28: on the climb, turned to CLIMB,
		// which a workout leaves to the rider (#3645).
		await o.page.getByTestId('bike-computer').getByTitle('Next page').click();
		await o.page
			.locator('[data-testid=bike-computer][data-page=climb]')
			.waitFor();
		await s.shot(o, { name: 'ride-road-world-climb' });
		// multi:ride-road-world-map — item 30: M turns to MAP, the road from above (#3645).
		await o.page.keyboard.press('m');
		await o.page
			.locator('[data-testid=bike-computer][data-page=map]')
			.waitFor();
		await o.page.getByTestId('map-dot').waitFor();
		await o.page.evaluate(() =>
			(document.activeElement as HTMLElement)?.blur(),
		);
		await s.shot(o, { name: 'ride-road-world-map' });
		// multi:ride-road-world-map-rolling — item 30's muted road beside the ramp:
		// the swells' dot inside the last climb, flats and a descent in the same frame (#3645).
		const rolling = await fixtureRoad(o.page, 'rolling');
		await ride(o.page, `/ride?w=openers&road=${rolling}&from=5800`);
		await assertRiding(o.page, true);
		await o.page.keyboard.press('m');
		await o.page
			.locator('[data-testid=bike-computer][data-page=map]')
			.waitFor();
		await o.page.getByTestId('map-dot').waitFor();
		await o.page.evaluate(() =>
			(document.activeElement as HTMLElement)?.blur(),
		);
		await s.shot(o, { name: 'ride-road-world-map-rolling' });
		// multi:world-hairpins-trench — #3728: the first leg between two retaining walls, from km 1.5.
		await ride(o.page, `/ride?w=openers&road=${road}&from=1500`);
		await assertRiding(o.page, true);
		await s.shot(o, { name: 'world-hairpins-trench' });
		// multi:ride-road-world-flamme — #3645: the last kilometre to the top, the
		// flamme rouge flagged on the CLIMB page.
		await ride(o.page, `/ride?w=openers&road=${road}&from=6200`);
		await assertRiding(o.page, true);
		await o.page.getByTestId('bike-computer').getByTitle('Next page').click();
		await o.page.getByTestId('flamme-rouge').waitFor();
		await s.shot(o, { name: 'ride-road-world-flamme' });
		// multi:ride-road-world-summit — #3645: over the top of the rolling road's
		// first climb (km 3.0, class IV: no confetti, the budget is HC and I), the
		// strip above the Skyline.
		const rollingRoad = await fixtureRoad(o.page, 'rolling');
		await ride(o.page, `/ride?w=openers&road=${rollingRoad}&from=2900`);
		await assertRiding(o.page, true);
		await o.page.getByTestId('summit-strip').waitFor({ timeout: 60_000 });
		// The strip has risen: its `--dur-stage` rise, not a frame in it.
		await o.page.waitForTimeout(900);
		await s.shot(o, { name: 'ride-road-world-summit' });
		// multi:world-finish — item 29: about 150 m from the road’s end, the finish arch ahead (#3623).
		await ride(o.page, `/ride?w=openers&road=${road}&from=6950`);
		await assertRiding(o.page, true);
		await s.shot(o, { name: 'world-finish' });
		// multi:ride-road-world-climb-lands — item 37: a workout 200 m or so
		// before the rolling road's first climb, turned to CLIMB (#3101).
		await ride(o.page, `/ride?w=openers&road=${rollingRoad}&from=700`);
		await assertRiding(o.page, true);
		await o.page.getByTestId('bike-computer').getByTitle('Next page').click();
		await o.page
			.locator('[data-testid=bike-computer][data-page=climb]')
			.waitFor();
		await o.page.getByTestId('climb-lands').waitFor();
		await s.shot(o, { name: 'ride-road-world-climb-lands' });
		// multi:ride-road-world-gate — item 34: Smoke Test's second block starts
		// at 30 s, painted on the road ahead; shot once it is 20–35 m off, as
		// the world's probe measures it (#3101). The first block's 0:30 left
		// reads as a clock past any early second, so no second is waited for.
		await ride(o.page, `/ride?w=smoke-test&road=${road}&from=0`, {
			second: 0,
		});
		await o.page.waitForFunction(
			() => {
				const probe = (
					window as {
						__worldProbe?: () => { gates?: { aheadM: number }[] };
					}
				).__worldProbe?.();
				const ahead = probe?.gates?.[0]?.aheadM ?? Infinity;
				return ahead >= 20 && ahead <= 35;
			},
			undefined,
			{ polling: 100, timeout: 90_000 },
		);
		await s.shot(o, { name: 'ride-road-world-gate' });
	},
	{ once: true },
);

surface(
	'ride-workout-world',
	async (s) => {
		// A negative check: no road, so no world (G9). Recorded, not asserted —
		// the probe's world.mounted is item 1's answer, and a world that mounts
		// here is the defect the shot exists to show.
		const o = await s.open(DESK, { world: true });
		await ride(o.page, '/ride?w=openers');
		await assertRiding(o.page);
		await s.shot(o);
	},
	{ once: true },
);

surface(
	'ride-workout-flat',
	async (s) => {
		const o = await s.open(DESK, { world: false });
		await ride(o.page, '/ride?w=openers');
		await assertRiding(o.page);
		await s.shot(o);
		// Four digits: a workout asking 1,100 W, which the simulated trainer holds.
		const big = await s.open(DESK, { world: false });
		await ride(big.page, `/ride?w=${await bigWatts(big.page)}`);
		await assertRiding(big.page);
		await s.shot(big, { name: 'ride-workout-flat-1000w' });
	},
	{ once: true },
);

/**
 * The trainer falls silent past SIGNAL_LOST_MS: a replay the spec serves
 * itself, twenty seconds long, after which the simulated trainer sends
 * nothing (simulated.ts, #54) — on the flat ride and on the world's.
 */
const SILENCE = {
	samples: Array.from({ length: 20 }, () => ({ watts: 200, cadence: 88 })),
};

surface(
	'ride-status',
	async (s) => {
		for (const [name, world, road] of [
			['ride-status', false, false],
			['ride-status-road-world', true, true],
		] as const) {
			const o = await s.open(DESK, { world });
			await o.page.route('**/fixtures/design-silence.json', (route) =>
				route.fulfill({ json: SILENCE }),
			);
			const on = road
				? `&road=${await fixtureRoad(o.page, 'hairpin')}&from=0`
				: '';
			await o.page.goto(`/ride?w=openers${on}&replay=design-silence`);
			// The replay starts the ride itself.
			await o.page.getByTestId('ride-replay').click({ timeout: 15_000 });
			// Twenty samples, SIGNAL_LOST_MS, and the line settling.
			await o.page.waitForTimeout(30_000);
			await s.shot(o, { name });
			await o.ctx.close();
		}
		// The free ride's own line atop slot 1 (#3669): the road, trainer silent.
		const f = await s.open(DESK, { world: true });
		await f.page.route('**/fixtures/design-silence.json', (route) =>
			route.fulfill({ json: SILENCE }),
		);
		const id = await fixtureRoad(f.page, 'hairpin');
		await f.page.goto(`/ride?road=${id}&replay=design-silence`);
		await f.page.getByText(ROADS.hairpin.name).first().waitFor();
		await f.page.getByTestId('ride-replay').click({ timeout: 15_000 });
		await f.page.waitForTimeout(30_000);
		await s.shot(f, { name: 'ride-status-free-road' });
		await f.ctx.close();
	},
	{ once: true },
);

surface(
	'ride-phone-remote',
	async (s) => {
		// The desk holds the trainer; the same rider's phone sees the claim
		// (ADR-0025) and offers to be its remote (#3217).
		const desk = await s.open(DESK, { world: false });
		const crew = await designCrew(desk.page);
		await toTraining(desk.page, crew);
		// The desk is in voice too, so the phone is a controller (ADR-0089).
		await desk.page.getByRole('button', { name: 'Join voice' }).click();
		await desk.page
			.getByRole('button', { name: 'microphone' })
			.waitFor({ timeout: 20_000 });
		const phone = await s.open(PHONE, { world: false });
		await phone.page.goto(`${voicePath(crew)}/training`);
		const offer = phone.page.getByRole('button', {
			name: 'Use this phone as your remote',
		});
		await offer.waitFor({ timeout: 20_000 });
		const moveVoice = phone.page
			.getByTestId('controller')
			.getByRole('button', { name: 'Use this device for voice' });
		await moveVoice.waitFor({ timeout: 20_000 });
		const box = await offer.boundingBox();
		const moveBox = await moveVoice.boundingBox();
		await s.shot(phone, {
			name: 'ride-phone-remote-offer',
			extra: {
				offerWidth: Math.round(box?.width ?? 0),
				offerHeight: Math.round(box?.height ?? 0),
				offerTextPx: await offer.evaluate((b) =>
					parseFloat(getComputedStyle(b).fontSize),
				),
				offerViewport: phone.page.viewportSize()?.width ?? 0,
				moveVoiceHeight: Math.round(moveBox?.height ?? 0),
				moveVoiceTextPx: await moveVoice.evaluate((b) =>
					parseFloat(getComputedStyle(b).fontSize),
				),
				controllerLine:
					(await phone.page
						.getByTestId('controller')
						.locator('p')
						.first()
						.textContent()) ?? null,
				// No call on a controller (ADR-0089): the mic and camera
				// controls exist only in voice, drawer or not.
				controllerCallControls: await phone.page
					.locator('[aria-label="microphone"], [aria-label="camera"]')
					.count(),
			},
		});
		// The drawer's voice row says the same (YouPanel).
		await phone.page.getByRole('button', { name: 'open navigation' }).click();
		await phone.page
			.getByRole('navigation', { name: 'crews and channels' })
			.getByText(/Your voice is on your/)
			.waitFor({ timeout: 10_000 });
		// The drawer slides in; shoot it once it has landed.
		await phone.page.waitForTimeout(1_000);
		await s.shot(phone, {
			name: 'ride-phone-remote-drawer',
			extra: {
				controllerCallControls: await phone.page
					.locator('[aria-label="microphone"], [aria-label="camera"]')
					.count(),
			},
		});
		await phone.page.keyboard.press('Escape');
		await offer.click();
		await phone.page.getByTestId('phone-remote').waitFor();
		// The desk rides SIM with gears on (dev login); one Harder tap makes
		// the holding tab answer with its GearState, so the gear line shows.
		await phone.page
			.getByTestId('phone-remote')
			.getByRole('button', { name: 'Harder' })
			.click();
		await phone.page
			.getByTestId('phone-remote')
			.locator('p[aria-live=polite]')
			.waitFor({ timeout: 10_000 });
		const remote = await phone.page
			.getByTestId('phone-remote')
			.evaluate((el) => {
				const buttons = [...el.querySelectorAll('button')].filter(
					(b) => b.textContent?.trim() !== 'Done',
				);
				const px = (n: number) => Math.round(n * 10) / 10;
				return {
					remoteCells: buttons.length,
					remoteMinHeight: px(
						Math.min(...buttons.map((b) => b.getBoundingClientRect().height)),
					),
					remoteMinWidth: px(
						Math.min(...buttons.map((b) => b.getBoundingClientRect().width)),
					),
					remoteDisabled: buttons.filter((b) => b.disabled).length,
					remoteTextMinPx: px(
						Math.min(
							...[...el.querySelectorAll('h2, p, button')].map((n) =>
								parseFloat(getComputedStyle(n).fontSize),
							),
						),
					),
					remoteGearPx: px(
						parseFloat(
							getComputedStyle(el.querySelector('p[aria-live=polite]') ?? el)
								.fontSize,
						),
					),
					remoteGearLine:
						el.querySelector('p[aria-live=polite]')?.textContent?.trim() ??
						null,
					remoteHint:
						[...el.querySelectorAll('p:not([aria-live])')].map((n) =>
							n.textContent?.trim(),
						)[0] ?? null,
					remoteEnabled: buttons
						.filter((b) => !b.disabled)
						.map((b) => b.textContent?.trim()),
					remotePair: buttons.some((b) => b.textContent?.trim() === 'Pause'),
					remoteScrollWidth: el.scrollWidth,
					remoteClientWidth: el.clientWidth,
				};
			});
		await s.shot(phone, { name: 'ride-phone-remote', extra: remote });
		await desk.page.getByRole('button', { name: 'End ride' }).click();
		// A solo ride is the one a phone may pause (#3217): the desk rides
		// Openers beside the channel, the phone pauses it, and both say so.
		await desk.page
			.getByRole('button', { name: 'Ride a workout' })
			.click({ timeout: 15_000 });
		const ride = desk.page.getByRole('dialog', { name: 'Ride a workout' });
		await ride.getByRole('textbox', { name: 'find a workout' }).fill('Openers');
		await ride
			.getByRole('button', { name: /Openers/ })
			.first()
			.click();
		await ride.getByRole('button', { name: 'Ride Openers' }).click();
		const pause = phone.page
			.getByTestId('phone-remote')
			.getByRole('button', { name: 'Pause' });
		await pause.waitFor({ timeout: 30_000 });
		await s.shot(phone, {
			name: 'ride-phone-remote-solo',
			extra: {
				remotePair: true,
				pauseDisabled: await pause.isDisabled(),
			},
		});
		await s.shot(desk, { name: 'ride-status-solo' });
		await pause.click();
		await phone.page
			.getByTestId('phone-remote')
			.getByText('Paused', { exact: true })
			.waitFor({ timeout: 10_000 });
		const paused = await phone.page
			.getByTestId('phone-remote')
			.evaluate((el) => {
				const b = (name: string) =>
					[...el.querySelectorAll('button')].find(
						(x) => x.textContent?.trim() === name,
					);
				return {
					pauseResumeHeight: Math.round(
						b('Resume')?.getBoundingClientRect().height ?? 0,
					),
					pauseDisabled: b('Pause')?.disabled ?? null,
					resumeDisabled: b('Resume')?.disabled ?? null,
				};
			});
		await s.shot(phone, { name: 'ride-phone-remote-paused', extra: paused });
		await desk.page.getByText('Paused', { exact: true }).first().waitFor();
		const line = await desk.page
			.getByText('Paused', { exact: true })
			.first()
			.evaluate((n) => {
				const row = n.closest('[role=status]') ?? n.parentElement;
				const resume = row?.querySelector('button');
				return {
					pausedLine: n.textContent?.trim(),
					pausedResumeHeight: Math.round(
						resume?.getBoundingClientRect().height ?? 0,
					),
					pausedResumeText: resume?.textContent?.trim() ?? null,
				};
			});
		await s.shot(desk, { name: 'ride-status-paused', extra: line });
	},
	{ once: true },
);

surface(
	'ride-skyline-fallback',
	async (s) => {
		// Forced onto the Skyline as the rider sets it on this device, then again
		// under reduced motion.
		// Never chosen, reduced motion opens on Flat by itself (ADR-0079).
		for (const [name, reducedMotion, flat] of [
			['ride-skyline-fallback', undefined, true],
			['ride-skyline-fallback-reduced', 'reduce', false],
		] as const) {
			const o = await s.open(DESK, { world: false, reducedMotion });
			if (flat)
				await o.ctx.addInitScript(() =>
					localStorage.setItem('wattroom.world.mode.v1', 'flat'),
				);
			const road = await fixtureRoad(o.page, 'hairpin');
			await ride(o.page, `/ride?w=openers&road=${road}`);
			await assertRiding(o.page);
			await o.page.getByTestId('flat-road').waitFor();
			await s.shot(o, { name });
		}
	},
	{ once: true },
);

surface(
	'ride-countin',
	async (s) => {
		// With the OS set to light, so the frame shows it keeps the rider's
		// scheme from the count-in's first frame (G1, #4160).
		const o = await s.open({ ...DESK, colorScheme: 'light' }, { world: true });
		const road = await fixtureRoad(o.page, 'hairpin');
		const count = await holdCountIn(o.page);
		await o.page.goto(`/ride?w=openers&road=${road}`);
		await o.page
			.getByRole('button', { name: 'Ride simulated' })
			.first()
			.click({ timeout: 15_000 });
		await count.hold();
		await o.page
			.getByRole('button', { name: /^Start (riding|the ride)$/ })
			.first()
			.click();
		// The digit, flat or over the world (#3668), the ground whole around the eye.
		await o.page.getByTestId('count-in').waitFor({ timeout: 5000 });
		await o.page.waitForFunction(
			() =>
				(
					window as unknown as {
						__worldProbe?: () => { ground?: { pending: number } };
					}
				).__worldProbe?.().ground?.pending === 0,
			null,
			{ timeout: 120_000 },
		);
		await s.shot(o, { name: 'ride-countin-first' });
		// One second into the 3 s count-in: the held pose, the arch and the digit.
		await count.tick();
		await s.shot(o);
	},
	{ once: true },
);

/** No ghost on this ride: the free road's own surfaces stay ride-free-road-ghost's baseline (#3245). */
const withoutGhost = (page: Page) =>
	page.route('**/api/routes/*/ghost', (r) =>
		r.fulfill({
			status: 404,
			json: { error: 'not_found', message: 'No ghost in this capture.' },
		}),
	);

surface(
	'ride-free-road',
	async (s) => {
		// World off, with the OS set to light: the ride keeps it (G1, #4160).
		const o = await s.open({ ...DESK, colorScheme: 'light' }, { world: false });
		const road = await fixtureRoad(o.page, 'hairpin');
		await withoutGhost(o.page);
		// Before the first stroke the setup is a desk surface; the ride starts
		// with the first stroke, not with the page (G1, #3667).
		await o.page.goto(`/ride?road=${road}`);
		await o.page
			.getByRole('button', { name: 'Ride simulated' })
			.first()
			.waitFor({ timeout: 15_000 });
		await s.shot(o, { name: 'ride-free-road-setup' });
		await ride(o.page, `/ride?road=${road}`);
		await assertRiding(o.page);
		await s.shot(o);
	},
	{ once: true },
);

surface(
	'ride-free-road-world',
	async (s) => {
		// The world on: a free ride on a road draws it in slot 2 (#3669).
		const o = await s.open(DESK, { world: true });
		const road = await fixtureRoad(o.page, 'hairpin');
		await withoutGhost(o.page);
		await ride(o.page, `/ride?road=${road}`);
		await assertRiding(o.page, true);
		await s.shot(o);
	},
	{ once: true },
);

surface(
	'ride-free-road-ghost',
	async (s) => {
		// Your ghost beside you (#3245). The designer's seeded timed ride up the
		// hairpin road's approach (design-seed's timedRide) rides behind the
		// chase camera by the shot, so the earlier effort here is a synthetic
		// line a little faster than the simulated rider: in frame, just ahead.
		const o = await s.open(DESK, { world: true });
		const road = await fixtureRoad(o.page, 'hairpin');
		await o.page.route('**/api/routes/*/ghost', (r) =>
			r.fulfill({
				json: {
					best: true,
					startedAt: new Date(Date.now() - 13 * 86_400_000).toISOString(),
					seconds: 600,
					metres: Array.from({ length: 601 }, (_, i) => i * 4.2),
				},
			}),
		);
		await ride(o.page, `/ride?road=${road}`);
		await assertRiding(o.page, true);
		await o.page.getByTestId('skyline-ghost').waitFor({ timeout: 15_000 });
		await s.shot(o);
		// The RIDE page with a ghost: vs best, in words (#3246, the one-home table).
		const computer = o.page.getByTestId('bike-computer').first();
		if ((await computer.getAttribute('data-page')) !== 'ride')
			await computer
				.getByRole('button', { name: /(previous|next) page, RIDE/ })
				.click();
		await computer.locator('[data-field=split]').waitFor({ timeout: 15_000 });
		await s.shot(o, { name: 'ride-free-road-ghost-ride' });
	},
	{ once: true },
);

surface(
	'ride-tv',
	async (s) => {
		const o = await s.open(TV, { world: true });
		await ride(o.page, '/ride?w=openers');
		await o.page
			.getByRole('button', { name: 'TV', exact: true })
			.first()
			.click();
		await o.page.waitForTimeout(3000);
		await assertRiding(o.page);
		await s.shot(o);
	},
	{ once: true },
);

surface(
	'phone-ride',
	async (s) => {
		const o = await s.open(RIDING_PHONE, { world: true });
		await ride(o.page, '/ride?w=openers');
		await assertRiding(o.page);
		await s.shot(o, { full: true });
	},
	{ once: true },
);

surface('phone-ride-road-flat', async (s) => {
	// phone-ride-road's recipe with the world off: the world on a free ride's
	// road is #3663's, and its other items — the road line, the CLIMB page,
	// the Skyline — do not wait for it.
	const o = await s.open(RIDING_PHONE, { world: false });
	const road = await fixtureRoad(o.page, 'hairpin');
	await ride(o.page, `/ride?road=${road}`);
	await assertRiding(o.page);
	await s.shot(o, { full: true });
});

surface(
	'phone-ride-road',
	async (s) => {
		// The world on: a free ride on a road is a band in slot 2's place (#3676).
		const o = await s.open(RIDING_PHONE, { world: true });
		const road = await fixtureRoad(o.page, 'hairpin');
		await ride(o.page, `/ride?road=${road}`);
		await assertRiding(o.page, true);
		await s.shot(o, { full: true });
	},
	{ once: true },
);

surface(
	'hud',
	async (s) => {
		// /hud beside a road free ride: the desktop shell's 320 × 152 window, and
		// ADR-0041's second-screen tab.
		const o = await s.open(DESK, { world: false });
		const road = await fixtureRoad(o.page, 'hairpin');
		await ride(o.page, `/ride?road=${road}`, { second: 8 });
		await assertRiding(o.page);
		for (const [name, size] of [
			['hud-shell', HUD_SHELL],
			['hud', DESK.viewport!],
		] as const) {
			const hud = await o.ctx.newPage();
			const errors: string[] = [];
			hud.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
			await hud.setViewportSize(size);
			await hud.goto('/hud');
			await hud.waitForTimeout(4000);
			await s.shot(
				{ page: hud, errors },
				{ name, extra: { hud: await hud.evaluate(hudScale) } },
			);
			await hud.close();
		}
		// With no ride anywhere, the waiting state scales as the same block (#3678).
		const idle = await s.open(DESK, { as: 'Hud Watcher', world: false });
		await idle.page.goto('/hud');
		await idle.page.waitForTimeout(2500);
		await s.shot(idle, {
			name: 'hud-waiting',
			extra: { hud: await idle.page.evaluate(hudScale) },
		});
		// Signed out, in the shell's window and in a tab: the same block.
		for (const [name, size] of [
			['hud-signed-out-shell', HUD_SHELL],
			['hud-signed-out', DESK.viewport!],
		] as const) {
			const out = await s.open({ ...DESK, viewport: size }, { as: null });
			await out.page.goto('/hud');
			await out.page.waitForTimeout(2500);
			await s.shot(out, {
				name,
				extra: { hud: await out.page.evaluate(hudScale) },
			});
		}
	},
	{ also: ['hud-shell'], once: true },
);

surface('ride-preride', async (s) => {
	// With a remembered road (Designer has ridden one), and without (a rider
	// who never has); past a crew's doors (D11), which the seeded crew would
	// otherwise put first.
	const known = await s.open(DESK, { world: false });
	const hairpin = await fixtureRoad(known.page, 'hairpin');
	// What this device rode last is its own memory (#3671).
	await known.page.evaluate(
		(id) =>
			localStorage.setItem(
				'wattroom.last-ride.v1',
				JSON.stringify({ road: id, workout: 'openers' }),
			),
		hairpin,
	);
	await page(s, known, '/ride?alone', { name: 'ride-preride' });
	const fresh = await s.open(DESK, { as: 'Newcomer', world: false });
	await page(s, fresh, '/ride?alone', { name: 'ride-preride-no-road' });
});

surface(
	'ride-figure-card',
	async (s) => {
		// A rider who has not answered the card meets it at Start on a road
		// (#3342); the card measures its own targets for the probe.
		for (const [device, name] of variants([
			[DESK, 'ride-figure-card'],
			[RIDING_PHONE, 'phone-ride-figure-card'],
		] as const)) {
			const o = await s.open(device, { as: 'Unasked', world: false });
			const road = await fixtureRoad(o.page, 'hairpin');
			await o.page.goto(`/ride?road=${road}`);
			await o.page
				.getByRole('button', { name: 'Ride simulated' })
				.first()
				.click({ timeout: 15_000 });
			await o.page.getByRole('button', { name: 'Start the ride' }).click();
			const card = o.page.getByTestId('figure-card');
			await card.waitFor();
			const box = (label: string) =>
				card.getByRole('button', { name: label, exact: true }).boundingBox();
			const circle = card.getByTestId('figure-preview').locator('circle');
			const fill = () => circle.evaluate((c) => getComputedStyle(c).fill);
			const neutralFill = await fill();
			const swatch = card.getByRole('button', { name: /^Skin tone 4 of/ });
			const swatchFill = await swatch.evaluate(
				(b) => getComputedStyle(b).backgroundColor,
			);
			await swatch.click();
			const tappedFill = await fill();
			await s.shot(o, {
				name,
				full: true,
				extra: {
					'figure-card': {
						neutralFill,
						swatchFill,
						tappedFill,
						skip: await box('Skip'),
						save: await box('Save'),
						build: await box('slim'),
						height: await card.getByRole('slider').boundingBox(),
						swatch: await card
							.getByRole('button', { name: /^Skin tone 1 of/ })
							.boundingBox(),
					},
				},
			});
		}
	},
	{ also: ['phone-ride-figure-card'] },
);

surface('ride-roadpick', async (s) => {
	// The road picker, with both roads seeded, opened from /ride's
	// “Change” (#3671).
	const o = await s.open(DESK, { world: false });
	await fixtureRoad(o.page, 'hairpin');
	await fixtureRoad(o.page, 'rolling');
	await o.page.goto('/ride?alone');
	await o.page.getByRole('button', { name: 'Change' }).first().click();
	await o.page.waitForTimeout(1500);
	await s.shot(o, { full: true });
	// And its empty state, for a rider with no roads yet (#3683).
	const fresh = await s.open(DESK, { as: 'Newcomer', world: false });
	await fresh.page.goto('/ride?alone');
	await fresh.page.getByRole('button', { name: 'Change' }).first().click();
	await fresh.page.waitForTimeout(1500);
	await s.shot(fresh, { name: 'ride-roadpick-empty', full: true });
	// A row's name opens the route page.
	await o.page.getByRole('link', { name: /^Design switchbacks$/ }).click();
	await o.page.waitForURL('**/workouts/routes/*');
	await o.page.waitForTimeout(1500);
	await s.shot(o, { name: 'ride-roadpick-name-opens' });
});

surface('picker-race', async (s) => {
	// The session picker's Race it (#3777): Designer's voice channel, the
	// hairpin road picked, Last Light chosen so its clock shows. Then the
	// Games tab, which sends a race to the roads.
	const o = await s.open(DESK, { world: false });
	const crew = await designCrew(o.page);
	await fixtureRoad(o.page, 'hairpin');
	await toTraining(o.page, crew);
	if (await o.page.getByRole('button', { name: 'end the session' }).count()) {
		await endSession(o.page);
		await toTraining(o.page, crew);
	}
	await o.page.getByRole('button', { name: 'Start a session' }).click();
	const picker = o.page.getByRole('dialog', { name: 'Start a session' });
	await pickRoad(picker, ROADS.hairpin.name, 'Last Light');
	await o.page.waitForTimeout(1500);
	await s.shot(o);
	await picker.getByRole('button', { name: 'Games', exact: true }).click();
	await o.page.waitForTimeout(500);
	await s.shot(o, { name: 'picker-race-games' });
	// Its one line opens Race it on the roads.
	await press(picker.getByRole('button', { name: 'Race on a road' }));
	const races = picker.getByRole('group', { name: 'which race' });
	await races.waitFor();
	await s.shot(o, { name: 'picker-race-door' });
	// A Wheelrace's par the hub refuses is refused under the field, and
	// nothing is offered to start.
	await press(races.getByRole('button', { name: /^Wheelrace / }));
	await picker.getByRole('spinbutton', { name: /^par/ }).fill('50');
	await picker
		.getByRole('alert')
		.filter({ hasText: 'par is 15 to 45 minutes' })
		.waitFor();
	if (await picker.getByRole('button', { name: /^Start / }).count())
		throw new Error('a par of 50 minutes still offers a Start');
	await s.shot(o, { name: 'picker-race-par' });
});

surface(
	'ride-channel-free',
	async (s) => {
		// The voice channel's free ride starts itself once the trainer pairs.
		const o = await s.open(DESK, { world: false });
		const crew = await designCrew(o.page);
		await toTraining(o.page, crew);
		await atSecond(o.page, RIDE_SECOND);
		await assertRiding(o.page);
		// A track on the deck: the people column's seat (#3983).
		// Not one of ride-session-flat's: on the same channel's deck, a title
		// already showing would end its wait at once, and the next add would
		// meet the deck's burst throttle.
		await queueDeck(o.page, [['fJ9rUzIMcZQ', 'Bohemian Rhapsody']]);
		await s.shot(o);
		await o.page.getByRole('button', { name: 'End ride' }).click();
	},
	{ once: true },
);

surface(
	'ride-ramp',
	async (s) => {
		const o = await s.open(DESK);
		await o.page.goto('/ramp');
		await o.page
			.getByRole('button', { name: 'Ride simulated' })
			.first()
			.click({ timeout: 15_000 });
		await o.page.getByRole('button', { name: 'Start ramp test' }).click();
		await atSecond(o.page, RIDE_SECOND);
		await assertRiding(o.page);
		await s.shot(o);
	},
	{ once: true },
);

// ─── B. The world's look ─────────────────────────────────────────────────

/** /dev/world at one still moment (#3672): two loads are one frame, chrome off. */
const MOMENT_M = 11_000;
/** Just short of a hamlet of the dev road's first village, its roofs ahead (#3675). */
const HAMLET_AT = 1_100;
async function moment(
	s: Shoot,
	device: typeof DESK,
	p: 0 | 1,
	cam: 'chase' | 'side' = 'chase',
	m = MOMENT_M,
	extra = '',
) {
	const o = await s.open(device);
	await o.page.goto(
		`/dev/world?m=${m}&p=${p}&cam=${cam}&look=bluehour&chrome=0${extra}`,
	);
	await o.page.waitForFunction(
		() => !!(window as unknown as { __worldProbe?: unknown }).__worldProbe,
		null,
		{ timeout: 60_000 },
	);
	// The ground around the eye whole before the shot: a chunk still building is a frame two loads disagree on.
	await o.page.waitForFunction(
		() =>
			(
				window as unknown as {
					__worldProbe: () => { ground?: { pending: number } };
				}
			).__worldProbe().ground?.pending === 0,
		null,
		{ timeout: 60_000 },
	);
	await o.page.waitForTimeout(2000);
	return o;
}

/**
 * A moment shot, its page closed after: every world left drawing beside the
 * next one is a second software-GL world, which starved CI's runner (#3858).
 */
async function still(
	s: Shoot,
	device: typeof DESK,
	p: 0 | 1,
	{
		cam,
		m,
		name,
		extra,
	}: { cam?: 'chase' | 'side'; m?: number; name?: string; extra?: string } = {},
) {
	const o = await moment(s, device, p, cam, m, extra);
	await s.shot(o, { name });
	await o.ctx.close();
}

alone(() => {
	surface(
		'dev-world',
		async (s) => {
			const o = await s.open(DESK);
			await o.page.goto('/dev/world');
			await o.page.waitForTimeout(9000);
			await s.shot(o);
		},
		{ once: true },
	);

	surface(
		'world-start',
		async (s) => {
			await still(s, DESK, 0);
			await still(s, DESK_720, 0, { name: 'world-start-1280' });
			// multi:world-start-twice — the same moment loaded twice, compared pixel
			// for pixel.
			const frames: Buffer[] = [];
			for (let k = 0; k < 2; k++) {
				const o = await moment(s, DESK, 0);
				frames.push(await o.page.screenshot());
				await o.ctx.close();
			}
			await writeFile(join(s.out, 'world-start-twice.png'), frames[1]);
			await writeFile(
				join(s.out, 'world-start-twice.json'),
				JSON.stringify({ identical: frames[0].equals(frames[1]) }, null, 2) +
					'\n',
			);
			// multi:world-figure-side — the same moment from off your right shoulder,
			// where the chase camera never stands: the face, the drops, both wheels.
			await still(s, DESK, 0, { cam: 'side', name: 'world-figure-side' });
			// multi:world-figure-dots — you in Gipfelpunkte on a white ground (#3156).
			await still(s, DESK, 0, {
				cam: 'side',
				name: 'world-figure-dots',
				extra: '&kit=gipfelpunkte',
			});
			// multi:world-figure-motion — the side view riding on, four frames a
			// quarter-second apart, in hoops and in Gipfelpunkte: whether a pattern's edges crawl.
			for (const [kit, name] of [
				['hoops', 'world-figure-motion'],
				['gipfelpunkte', 'world-figure-dots-motion'],
			]) {
				const ride = await moment(
					s,
					DESK,
					0,
					'side',
					MOMENT_M,
					`&kit=${kit}&hold=0`,
				);
				for (let k = 1; k <= 4; k++) {
					await writeFile(
						join(s.out, `${name}-${k}.png`),
						await ride.page.screenshot(),
					);
					await ride.page.waitForTimeout(250);
				}
				await ride.ctx.close();
			}
			// multi:world-hamlet — houses are judged where a hamlet is in sight (#3675).
			await still(s, DESK, 0, { m: HAMLET_AT, name: 'world-hamlet' });
		},
		{ once: true },
	);

	surface(
		'world-end',
		async (s) => {
			await still(s, DESK, 1);
			await still(s, DESK_720, 1, { name: 'world-end-1280' });
		},
		{ once: true },
	);
});

// ─── C. Roads library ────────────────────────────────────────────────────

/** probe:doors — each shelf header row's doors: label, classes, box (#3685). */
const shelfDoors = () =>
	[...document.querySelectorAll('h2.eyebrow')].map((h) => ({
		shelf: h.textContent?.trim(),
		doors: [...(h.parentElement?.querySelectorAll('a, button') ?? [])].map(
			(d) => {
				const r = d.getBoundingClientRect();
				return {
					label: d.textContent?.trim(),
					cls: d.className,
					h: Math.round(r.height),
					right: Math.round(r.right),
				};
			},
		),
	}));

surface(
	'workouts',
	async (s) => {
		for (const [device, name] of variants([
			[DESK, 'workouts'],
			[PHONE, 'phone-workouts'],
		] as const)) {
			const o = await s.open(device);
			await page(s, o, '/workouts', { name, measure: { doors: shelfDoors } });
		}
		// A rider with no roads; then the route card's menu, its body opening
		// the route page, and its Ride starting F1 (#3683).
		const fresh = await s.open(DESK, { as: 'Newcomer' });
		await page(s, fresh, '/workouts', {
			name: 'workouts-empty',
			measure: { doors: shelfDoors },
		});
		const o = await s.open(DESK);
		const hairpin = await fixtureRoad(o.page, 'hairpin');
		await o.page.goto('/workouts');
		await o.page.waitForTimeout(2500);
		const card = o.page
			.getByRole('listitem')
			.filter({ has: o.page.locator(`a[href="/workouts/routes/${hairpin}"]`) });
		await card.click({ button: 'right', position: { x: 200, y: 60 } });
		await o.page.waitForTimeout(500);
		await s.shot(o, { name: 'workouts-route-menu' });
		await o.page.keyboard.press('Escape');
		// The search finds routes as well as workouts (#3685).
		const search = o.page.getByRole('searchbox', {
			name: 'Find a workout or a route',
		});
		await search.fill('swells');
		await o.page.waitForTimeout(500);
		await s.shot(o, { name: 'workouts-search' });
		await search.fill('');
		await card.click({ position: { x: 200, y: 60 } });
		await o.page.waitForURL(`**/workouts/routes/${hairpin}`);
		await o.page.waitForTimeout(1500);
		await s.shot(o, { name: 'workouts-route-card-opens' });
		await o.page.goto('/workouts');
		await o.page.waitForTimeout(2500);
		await card.getByRole('link', { name: /^(Ride|Carry on)$/ }).click();
		await o.page.waitForURL(/\/ride\?road=/);
		await o.page.waitForTimeout(2000);
		await s.shot(o, { name: 'flow-f1-2-ride' });
	},
	{ also: ['phone-workouts'] },
);

surface(
	'route',
	async (s) => {
		for (const [device, prefix] of variants([
			[DESK, 'route'],
			[PHONE, 'phone-route'],
		] as const))
			for (const road of ['hairpin', 'rolling'] as const) {
				const o = await s.open(device);
				const id = await fixtureRoad(o.page, road);
				await page(s, o, `/workouts/routes/${id}`, {
					name: road === 'hairpin' ? prefix : `${prefix}-${road}`,
				});
			}
		// Where the route page's links lead (#3680): the primary, from where the
		// last ride stopped, and the best ride (the seed's timed one).
		const o = await s.open(DESK);
		const id = await fixtureRoad(o.page, 'hairpin');
		await o.page.goto(`/workouts/routes/${id}`);
		const carry = o.page.getByRole('button', { name: /^From km / });
		await carry.waitFor({ timeout: 15_000 });
		await carry.click();
		await o.page.getByRole('link', { name: 'Ride it' }).click();
		await o.page.waitForURL(/\/ride\?road=.+&from=\d+/);
		await o.page.waitForTimeout(2500);
		await s.shot(o, { name: 'route-ride-it' });
		await o.page.goto(`/workouts/routes/${id}`);
		await o.page.getByRole('link', { name: /^Best / }).click();
		await o.page.waitForURL('**/history/*');
		await o.page.waitForTimeout(2500);
		await s.shot(o, { name: 'route-best-opens' });
		// Ride its workout (#3601): the row picked, leg 1's setup, and its
		// summary with the offer of leg 2.
		const haul = await fixtureRoad(o.page, 'longHaul');
		await o.page.goto(`/workouts/routes/${haul}`);
		await o.page.getByRole('button', { name: /Ride its workout/ }).click();
		await o.page.waitForTimeout(500);
		await s.shot(o, { name: 'route-leg' });
		await o.page.getByRole('link', { name: 'Ride its workout' }).click();
		await o.page.waitForURL(/\/ride\?road=.+&leg=1/);
		await o.page
			.getByRole('button', { name: 'Ride simulated' })
			.first()
			.waitFor({ timeout: 15_000 });
		await s.shot(o, { name: 'route-leg-setup' });
		await ride(o.page, `/ride?road=${haul}&leg=1`, { second: 65 });
		await o.page
			.getByRole('button', { name: /^(End ride|Save at km)/ })
			.first()
			.click();
		await o.page.getByRole('button', { name: 'End the ride' }).click();
		const saveLeg = o.page.getByRole('button', { name: 'Save the ride' });
		if (await saveLeg.count()) await saveLeg.first().click();
		await o.page
			.getByRole('link', { name: /^Ride leg 2 of \d+$/ })
			.waitFor({ timeout: 30_000 });
		// The save settles into its banner before the shot.
		await o.page.waitForTimeout(2500);
		await s.shot(o, { name: 'route-leg-summary', full: true });
		// The offer rides the next leg: the same page, a new leg in its url.
		await o.page.getByRole('link', { name: /^Ride leg 2 of \d+$/ }).click();
		await o.page.waitForURL(/&leg=2/);
		await o.page
			.getByText(/leg 2 of \d+/)
			.first()
			.waitFor({ timeout: 15_000 });
		// Workout on it (#3681): the row picked, the shelf picking for this
		// road, and a card's Ride opening on it; then the shelf on a phone.
		await o.page.goto(`/workouts/routes/${id}`);
		await o.page.getByRole('button', { name: /Workout on it/ }).click();
		await o.page.waitForTimeout(500);
		await s.shot(o, { name: 'route-workout-on' });
		await o.page.getByRole('link', { name: 'Pick a workout' }).click();
		await o.page.waitForURL(/\/workouts\?on=/);
		await o.page.waitForTimeout(2500);
		await s.shot(o, { name: 'workouts-on' });
		await o.page
			.getByRole('listitem')
			.filter({
				has: o.page.getByRole('link', { name: 'Recovery Spin', exact: true }),
			})
			.getByRole('button', { name: 'Ride', exact: true })
			.click();
		await o.page.getByText(/where to start\?/).waitFor({ timeout: 15_000 });
		await s.shot(o, { name: 'workouts-on-ride' });
		// A phone that rides: one that cannot never reaches the pick.
		const p = await s.open(RIDING_PHONE);
		await page(s, p, `/workouts?on=${await fixtureRoad(p.page, 'hairpin')}`, {
			name: 'phone-workouts-on',
		});
	},
	{ also: ['phone-route'] },
);

surface(
	'workout-editor',
	async (s) => {
		for (const [device, name] of variants([
			[DESK, 'workout-editor'],
			[PHONE, 'phone-workout-editor'],
		] as const)) {
			const o = await s.open(device);
			await page(s, o, '/workouts/edit', { name });
		}
		// The selected block's cadence and heart-rate bands, unfolded (#3906).
		const o = await s.open(DESK);
		await o.page.goto('/workouts/edit');
		await o.page
			.locator('summary', { hasText: 'cadence and heart-rate bands' })
			.click();
		await o.page.waitForTimeout(500);
		await s.shot(o, { name: 'workout-editor-bands', full: true });
	},
	{ also: ['phone-workout-editor'] },
);

test.fixme('routes', () => {
	// /workouts/routes is still to come (#3692).
});

// ─── D. After the ride: what the seed saved ──────────────────────────────

surface(
	'poster',
	async (s) => {
		// The share card is an image: the file itself is the shot, and there is
		// no page to probe.
		const o = await s.open(DESK);
		const id = await savedRide(o.page, await fixtureRoad(o.page, 'hairpin'));
		const res = await o.page.request.get(`/api/rides/${id}/card.png`);
		if (!res.ok()) throw new Error(`card.png answered ${res.status()}`);
		await writeFile(join(s.out, 'poster.png'), await res.body());
	},
	{ once: true },
);

surface(
	'history',
	async (s) => {
		// With no ride (a rider who never rode), and with the seed's (Designer).
		for (const [device, suffix] of variants([
			[DESK, ''],
			[PHONE, '-phone'],
		] as const)) {
			const fresh = await s.open(device, { as: 'Newcomer' });
			await page(s, fresh, '/history', { name: `history${suffix}` });
			const rode = await s.open(device);
			await page(s, rode, '/history', { name: `history-rides${suffix}` });
		}
	},
	{ also: ['history-rides'] },
);

test.fixme('collections', () => {
	// The Collections tab comes with design/collections (#3693).
});

// ─── E. Home, settings and the landing page ──────────────────────────────

surface(
	'home',
	async (s) => {
		// Designer in one crew, with two sessions planned this week (the seed).
		for (const [device, name] of variants([
			[DESK, 'home'],
			[PHONE, 'phone-home'],
		] as const)) {
			const o = await s.open(device);
			await page(s, o, '/home', { name, measure: { home: homeProbe } });
			if (device !== DESK) continue;
			// multi:home-sheet — where a rider in a crew starts or joins
			// another: the action row's crew button opens the sheet (#3688).
			const desk = o.page.viewportSize()!;
			await o.page.setViewportSize({ width: desk.width, height: 900 });
			await o.page
				.getByTestId('home-actions')
				.getByRole('button', { name: /^(Start|Join) a crew$/ })
				.click();
			await o.page.getByRole('dialog').waitFor();
			await o.page.waitForTimeout(500);
			await s.shot(o, { name: 'home-sheet' });
			// multi:home-desktop-offer — the desktop app's offer, which a
			// browser on a desk sees once a build is out: last on the page.
			// A phone is never offered it (DesktopNotice).
			const offer = await s.open({ ...DESK, userAgent: WINDOWS_UA });
			await offer.page.route(RELEASE_FEED, (route) =>
				route.fulfill({ json: DESKTOP_RELEASE }),
			);
			await page(s, offer, '/home', {
				name: 'home-desktop-offer',
				measure: { home: homeProbe },
			});
			// multi:home-week-* — This week's other states (#3689, TARGETS
			// home 7-8), the schedule and the crews' live read answered here.
			for (const [state, sessions, riding] of WEEK_STATES) {
				const o = await s.open(DESK);
				await o.page.route('**/api/schedule', (route) =>
					route.fulfill({ json: { sessions: sessions(), icsToken: '' } }),
				);
				if (riding)
					await o.page.route('**/api/crews/live', async (route) => {
						const res = await route.fetch();
						const body = (await res.json()) as LiveRead;
						const voice = body.crews[0]?.channels.find(
							(ch) => ch.kind === 'voice',
						);
						// A session's riders stand in its channel, as the hub
						// reports them (presence.go Occupants).
						if (voice) {
							voice.session = RIDING_SESSION();
							voice.occupants = [RIDER_TWO];
						}
						await route.fulfill({ response: res, json: body });
					});
				await page(s, o, '/home', {
					name: `home-week-${state}`,
					measure: { home: homeProbe },
				});
			}
		}
	},
	{ also: ['phone-home'] },
);

type LiveRead = {
	crews: {
		channels: { kind: string; session?: unknown; occupants?: unknown[] }[];
	}[];
};
const planned = (id: string, hours: number, goingCount: number) => ({
	id,
	workoutName: id === 'gone' ? 'Openers before work' : 'Saturday long tempo',
	minutes: 60,
	startsAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
	createdBy: 'Designer',
	crewId: '00000000-0000-0000-0000-000000000000',
	crewName: 'Design Crew',
	channelName: 'Pain Cave',
	goingCount,
});
const RIDER_TWO = {
	id: '00000000-0000-0000-0000-0000000000bb',
	name: 'Rider Two',
	riding: true,
};
/** The session riding now in the crew's voice channel, ten minutes in. */
const RIDING_SESSION = () => ({
	id: '00000000-0000-0000-0000-0000000000aa',
	channel: '',
	workout: 'Sweet spot 2×20',
	phase: 'running',
	elapsed: 600,
	coach: '',
	coachName: 'Designer',
	riders: ['Designer', RIDER_TWO.name],
	riderIds: ['', RIDER_TWO.id],
});
const WEEK_STATES: [string, () => unknown[], boolean][] = [
	// Nothing this week: the first plan after it, under NEXT.
	['next', () => [planned('later', 24 * 9, 3)], false],
	// Nothing planned at all: one teaching line.
	['empty', () => [], false],
	// A session riding now, and a plan whose time has just gone.
	['live', () => [planned('gone', -0.2, 0), planned('later', 26, 4)], true],
];

const WINDOWS_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
/** A desktop build, as the release feed lists one (desktop.spec.ts's). */
const DESKTOP_RELEASE = {
	tag_name: 'desktop-v0.2.0',
	html_url:
		'https://github.com/natrontech/wattroom-releases/releases/tag/desktop-v0.2.0',
	assets: [
		{
			name: 'WattRoom-0.2.0-win-x64.exe',
			browser_download_url: 'https://dl.test/WattRoom-0.2.0-win-x64.exe',
			size: 90000000,
		},
	],
};

surface('flow-f1', async (s) => {
	// F1's first steps (#3683): Workouts, then a route card's Ride onto /ride.
	const o = await s.open(DESK, { world: false });
	const road = await fixtureRoad(o.page, 'hairpin');
	// The screen F1's Ride lands on, reached by its URL, so main has it too.
	await o.page.goto(`/ride?road=${road}`);
	await o.page.waitForTimeout(2500);
	await s.shot(o, { name: 'flow-f1-0-ride-by-url' });
	const desk = o.page.viewportSize()!;
	await page(s, o, '/workouts', { name: 'flow-f1-1-workouts' });
	// The whole-page shot grew the window; /ride is shot at the desk's own.
	await o.page.setViewportSize(desk);
	await o.page
		.getByRole('listitem')
		.filter({ has: o.page.locator(`a[href="/workouts/routes/${road}"]`) })
		.getByRole('link', { name: /^(Ride|Carry on)$/ })
		.click();
	await o.page.waitForTimeout(2500);
	await s.shot(o, { name: 'flow-f1-2-ride' });
});

surface('appearance', async (s) => {
	for (const [device, suffix] of variants([
		[DESK, ''],
		[PHONE, '-phone'],
	] as const)) {
		const o = await s.open(device);
		await page(s, o, '/settings/appearance', {
			name: `appearance${suffix}`,
		});
	}
	const reduced = await s.open(DESK, { reducedMotion: 'reduce' });
	await page(s, reduced, '/settings/appearance', {
		name: 'appearance-reduced',
	});
});

surface('settings-this-computer', async (s) => {
	// "This computer" draws only inside the desktop shell, so the capture
	// hands the page a stand-in bridge with the two switches it asks about.
	for (const [device, name, platform, icon] of variants([
		[DESK, 'settings-this-computer', 'darwin', false],
		[DESK, 'settings-this-computer-linux', 'linux', true],
		[DESK, 'settings-this-computer-linux-off', 'linux', false],
		[PHONE, 'settings-this-computer-phone', 'darwin', false],
	] as const)) {
		const o = await s.open(device);
		await o.ctx.addInitScript(
			([os, on]) => {
				const answer = (enabled: boolean) => () =>
					Promise.resolve({ supported: true, enabled, error: null });
				(window as unknown as { wattroom: object }).wattroom = {
					version: '2026.10.1',
					platform: os,
					titleBar: 0,
					launchAtLogin: answer(false),
					trayIcon: answer(on),
				};
			},
			[platform, icon] as const,
		);
		await page(s, o, '/settings/notifications', { name });
	}
	const browser = await s.open(DESK);
	await page(s, browser, '/settings/notifications', {
		name: 'settings-this-computer-browser',
	});
});

alone(() => {
	surface('landing', async (s) => {
		// Signed out, as a stranger meets it: the landing on the desk and a phone,
		// then the public pages that share its copy.
		for (const [device, name, path] of variants([
			[DESK, 'landing', '/'],
			[PHONE, 'landing-phone', '/'],
			[DESK, 'landing-de', '/de'],
			[DESK, 'landing-game-modes', '/game-modes'],
			[DESK, 'landing-zwift-alternative', '/zwift-alternative'],
			[DESK, 'landing-smart-trainer-app', '/smart-trainer-app'],
		] as const)) {
			const o = await s.open(device, { as: null });
			await page(s, o, path, { name });
		}
	});

	surface('flow-f3', async (s) => {
		// Flow F3, a first run: a fresh account's Home and its set-up card → /ride
		// → the simulated trainer paired → the first ride → the closing card →
		// Home, with the ride under Recent rides. A new rider every run, named in
		// letters only (the dev door's rule), so it shares nothing with Designer.
		const letters = Date.now()
			.toString(26)
			.replace(/[0-9]/g, (d) => 'klmnopqrst'[Number(d)])
			.slice(-8);
		const o = await s.open(DESK, { as: `First ${letters}`, world: false });
		await page(s, o, '/home', {
			name: 'flow-f3-1-home',
			measure: { home: homeProbe },
		});
		await page(s, o, '/ride?w=smoke-test', { name: 'flow-f3-2-ride' });
		await o.page
			.getByRole('button', { name: 'Ride simulated' })
			.first()
			.click({ timeout: 15_000 });
		await o.page.getByRole('button', { name: 'Start the ride' }).waitFor();
		await s.shot(o, { name: 'flow-f3-3-paired' });
		await o.page.getByRole('button', { name: 'Start the ride' }).click();
		await atSecond(o.page, RIDE_SECOND);
		await s.shot(o, { name: 'flow-f3-4-riding' });
		// A long workout name in the opening eyebrow: its width is the CSS's, so
		// the text is swapped in place and the probes measure the header.
		await o.page
			.getByTestId('ride-context')
			.evaluate(
				(el, name) => (el.textContent = name),
				`Solo · ${'A very long workout name '.repeat(6)}`,
			);
		await s.shot(o, { name: 'flow-f3-4-riding-long-name' });
		await o.page
			.getByRole('link', { name: 'See your ride' })
			.waitFor({ timeout: 120_000 });
		await o.page.waitForTimeout(1500);
		await s.shot(o, { name: 'flow-f3-5-closing-card', full: true });
		await page(s, o, '/home', {
			name: 'flow-f3-6-home',
			measure: { home: homeProbe },
		});
		if (!takes(PHONE)) return;
		// The same Recent rides row at phone width, with a long ride name.
		const phone = await s.open(PHONE, {
			as: `First ${letters}`,
			world: false,
		});
		await phone.page.goto('/home');
		const row = phone.page.getByRole('link', { name: /Smoke Test/ }).first();
		await row.waitFor({ timeout: 15_000 });
		await row.evaluate((el) => {
			const name = el.querySelector('span.font-display');
			if (name) name.textContent = 'A very long workout name '.repeat(6);
		});
		await s.shot(phone, { name: 'flow-f3-6-home-phone-long-name', full: true });
	});
});

// ─── F, G. Garage and open rides ─────────────────────────────────────────

for (const id of ['garage-shop', 'garage-locker', 'garage-makers'])
	test.fixme(id, () => {
		// /garage comes with the garage issues (#3694).
	});

test.fixme('open-rides', () => {
	// /open-rides comes with #3307.
});

// ─── Last: what writes Designer's rides, routes and live sessions ────────
// Everything above sees the seed alone; these see it plus each other.

surface(
	'import',
	async (s) => {
		for (const [device, suffix] of variants([
			[DESK, ''],
			[PHONE, '-phone'],
		] as const)) {
			const o = await s.open(device);
			await page(s, o, '/workouts/import', { name: `import-idle${suffix}` });
			await readRoad(o.page, 'hairpin');
			await o.page.waitForTimeout(2500);
			await s.shot(o, { name: `import${suffix}`, full: true });
			const before = await routeIds(o.page);
			await o.page.getByRole('button', { name: 'Save to my routes' }).click();
			await o.page.getByText(/is on your routes/).waitFor({ timeout: 15_000 });
			await s.shot(o, { name: `import-saved${suffix}`, full: true });
			// The saved copy goes again, so the shelf keeps only the fixtures.
			for (const id of await routeIds(o.page))
				if (!before.has(id))
					await o.page.evaluate(
						(id) => fetch(`/api/routes/${id}`, { method: 'DELETE' }),
						id,
					);
		}
		// The rolling road read too: flats and a descent between its climbs, so
		// the line's own neon shows beside the climbs' ramp (#3679).
		const o = await s.open(DESK);
		// Every "Import a route" door's header, and a file dragged over the
		// idle card (#3684).
		await page(s, o, '/workouts/import?as=route', { name: 'import-as-route' });
		await o.page.locator('.border-dashed').first().dispatchEvent('dragover');
		await s.shot(o, { name: 'import-dragging', full: true });
		await readRoad(o.page, 'rolling');
		await o.page.waitForTimeout(2500);
		await s.shot(o, { name: 'import-rolling', full: true });
	},
	{ also: ['import-idle', 'import-saved'] },
);

async function routeIds(page: Opened['page']): Promise<Set<string>> {
	const { routes } = (await (await page.request.get('/api/routes')).json()) as {
		routes: { id: string }[];
	};
	return new Set(routes.map((r) => r.id));
}

surface(
	'ride-road-end',
	async (s) => {
		// ride-free-road past its minute, then End ride: the card the road ends
		// on, and what it closes to (closing-card-road).
		const o = await s.open(DESK, { world: false });
		const road = await fixtureRoad(o.page, 'hairpin');
		await ride(o.page, `/ride?road=${road}`, { second: 65 });
		await o.page
			// “Save at km …” while there is somewhere to carry on from (road-end.ts).
			.getByRole('button', { name: /^(End ride|Save at km)/ })
			.first()
			.click();
		await o.page.waitForTimeout(1500);
		await s.shot(o, { full: true });
		const save = o.page.getByRole('button', { name: 'Save the ride' });
		if (await save.count()) await save.first().click();
		await o.page
			.getByRole('link', { name: 'See your ride' })
			.waitFor({ timeout: 30_000 });
		await s.shot(o, { name: 'closing-card-road', full: true });
		// F1's last step (#3680): the road's name opens its page, the ride on it.
		await o.page.getByRole('link', { name: ROADS.hairpin.name }).click();
		await o.page.waitForURL(`**/workouts/routes/${road}`);
		await o.page.waitForTimeout(2500);
		await s.shot(o, { name: 'route-after-ride', full: true });
	},
	{ also: ['closing-card-road'] },
);

/** A 65 s workout, ridden to its closing card. */
async function rideToTheCard(o: Opened, onMount?: () => Promise<void>) {
	await ride(o.page, '/ride?w=smoke-test');
	await onMount?.();
	await o.page
		.getByRole('link', { name: 'See your ride' })
		.waitFor({ timeout: 120_000 });
	await o.page.waitForTimeout(1500);
}

surface('closing-card', async (s) => {
	// Flow F2 around it: /ride with the workout → riding → the closing card →
	// See your ride → the ride page wearing the card's header and tiles.
	const o = await s.open(DESK, { world: false });
	await page(s, o, '/ride?w=smoke-test', { name: 'flow-f2-1-preride' });
	await o.page
		.getByRole('button', { name: 'Ride simulated' })
		.first()
		.click({ timeout: 15_000 });
	await o.page.getByRole('button', { name: 'Start the ride' }).click();
	await atSecond(o.page, RIDE_SECOND);
	await s.shot(o, { name: 'flow-f2-2-riding' });
	await o.page
		.getByRole('link', { name: 'See your ride' })
		.waitFor({ timeout: 120_000 });
	await o.page.waitForTimeout(1500);
	await s.shot(o, { full: true });
	await o.page.getByRole('link', { name: 'See your ride' }).click();
	await o.page.waitForURL(/\/history\//);
	await o.page.waitForTimeout(2500);
	await s.shot(o, { name: 'flow-f2-4-ride-page', full: true });
	for (const [device, name, reducedMotion] of variants([
		[DESK, 'closing-card-reduced', 'reduce'],
		[RIDING_PHONE, 'closing-card-phone', undefined],
	] as const)) {
		const other = await s.open(device, { world: false, reducedMotion });
		// Under reduced motion the finished card appears at once: a frame the
		// moment the card mounts, and the settled one beside it.
		await rideToTheCard(other, async () => {
			if (!reducedMotion) return;
			await other.page
				.getByTestId('closing-card')
				.waitFor({ timeout: 120_000 });
			await s.shot(other, { name: 'closing-card-reduced-0' });
		});
		await s.shot(other, { name, full: true });
	}
	// The real card with what no ride here reaches: a medal and a scored
	// roster (/dev/summary renders SessionSummary with them).
	await page(s, o, '/dev/summary', { name: 'closing-card-medal' });
});

/**
 * The IFrame API, standing in for YouTube's (#3927): a player that plays what
 * it is given from where it is told, never ends and never errors, and shows
 * the video's own thumbnail where the video would be.
 */
const YOUTUBE_STUB = `
window.YT = { Player: class {
	constructor(node, opts) {
		this.node = typeof node === 'string' ? document.getElementById(node) : node;
		this.events = opts.events || {};
		this.state = -1; this.at = 0; this.since = 0;
		setTimeout(() => this.events.onReady?.({ target: this }));
	}
	show(id) {
		this.node.innerHTML = '<img src="https://i.ytimg.com/vi/' + id +
			'/mqdefault.jpg" alt="" style="width:100%;height:100%;object-fit:cover">';
	}
	go(state) { this.state = state; this.events.onStateChange?.({ data: state, target: this }); }
	loadVideoById(id, at = 0) { this.show(id); this.seekTo(at); this.go(1); }
	cueVideoById(id, at = 0) { this.show(id); this.seekTo(at); this.go(5); }
	playVideo() { this.since = Date.now(); this.go(1); }
	pauseVideo() { this.at = this.getCurrentTime(); this.go(2); }
	stopVideo() { this.pauseVideo(); }
	seekTo(at) { this.at = at; this.since = Date.now(); }
	getCurrentTime() { return this.state === 1 ? this.at + (Date.now() - this.since) / 1000 : this.at; }
	getDuration() { return 213; }
	getPlayerState() { return this.state; }
	getPlaybackRate() { return 1; }
	setPlaybackRate() {}
	getVideoData() { return { isLive: false }; }
	getVolume() { return 0; }
	setVolume() {}
	unloadModule() {}
	destroy() { this.node.innerHTML = ''; }
} };
window.onYouTubeIframeAPIReady?.();
`;

/**
 * Queues YouTube tracks on a riding page's deck through the jukebox's sheet
 * (#3983), stood in for by YOUTUBE_STUB, and leaves the sheet shut. A
 * channel's deck outlives its session.
 */
async function queueDeck(page: Page, tracks: [string, string][]) {
	await page.route('https://www.youtube.com/iframe_api', (route) =>
		route.fulfill({ contentType: 'text/javascript', body: YOUTUBE_STUB }),
	);
	const add = page.getByRole('textbox', {
		name: 'add music: search your library, or paste a YouTube link',
	});
	const fold = page.getByTestId('rail-sheet').filter({ visible: true });
	// Queued already when the queue's peek shows the second title: another
	// shot on the same channel may have put the first one on the deck.
	if (!(await add.isVisible())) await fold.click();
	const queued = await page
		.getByText((tracks[1] ?? tracks[0])[1])
		.filter({ visible: true })
		.count();
	// The hub takes one jukebox command per 300 ms from a rider and refuses
	// the rest, the stand-in player's own included: an add that does not
	// show is sent again.
	for (const [id, title] of queued ? [] : tracks) {
		const shown = page
			.getByText(new RegExp(`${id}|${title}`))
			.filter({ visible: true })
			.first();
		for (let tries = 3; ; tries--) {
			if (!(await add.isVisible())) await fold.click();
			await add.fill(`https://www.youtube.com/watch?v=${id}`);
			await add.press('Enter');
			// Past the queue's peek of three, a title shows once it is opened.
			await page.waitForTimeout(500);
			const more = page.getByRole('button', { name: /^\+\d+ more$/ });
			if (await more.isVisible()) await more.click();
			const ok = await shown
				.waitFor({ timeout: 5_000 })
				.then(() => true)
				.catch(() => false);
			if (ok) break;
			if (tries === 1) throw new Error(`${title} never reached the deck`);
		}
	}
	const fewer = page.getByRole('button', { name: 'fewer' });
	if (await fewer.isVisible()) await fewer.click();
	if (await add.isVisible()) await fold.click();
	return fold;
}

/**
 * Designer coaching, Design Partner riding along, a session started.
 * `prepare`: the coach's context before its first page of the crew.
 */
async function session(
	s: Shoot,
	pick: Parameters<typeof startSession>[1],
	world: boolean,
	prepare?: (coach: Opened) => Promise<void>,
) {
	const coach = await s.open(DESK, { world });
	await prepare?.(coach);
	const crew = await designCrew(coach.page);
	const rider = await s.open(DESK, { as: 'Design Partner', world });
	await toTraining(coach.page, crew);
	// A run that failed mid-session left it running: end it first.
	if (
		await coach.page.getByRole('button', { name: 'end the session' }).count()
	) {
		await endSession(coach.page);
		await toTraining(coach.page, crew);
	}
	await toTraining(rider.page, crew);
	await startSession(coach.page, pick);
	await joinSession(rider.page);
	// Started "without a trainer" (its trainer was on the free ride), the
	// coach rides along the way the partner does: a two-rider session.
	const coachJoins = coach.page.getByRole('link', { name: 'Join the ride' });
	if (await coachJoins.isVisible({ timeout: 5000 }).catch(() => false))
		await coachJoins.click();
	await atSecond(coach.page, RIDE_SECOND);
	return { coach, rider, crew };
}

surface(
	'ride-session-flat',
	async (s) => {
		// Past the minute it ends to its summary: closing-card-session. While it
		// runs, a third member watches: on the desk the voice channel is the
		// Watch view; a phone opens it from “Watch the session”.
		const { coach, crew } = await session(
			s,
			{ workout: 'Recovery Spin' },
			false,
		);
		try {
			await assertRiding(coach.page);
			// A track on the deck and a queue behind it: the transport, the
			// queue's rows and their vote and remove controls are what a rider
			// pedals with (#3927). Muted by the shoot's mixer. YouTube's own
			// player skips tracks at random in a headless browser, which empties
			// the deck, so it is stood in for by YOUTUBE_STUB; titles and
			// thumbnails are YouTube's.
			const fold = await queueDeck(coach.page, [
				['dQw4w9WgXcQ', 'Never Gonna Give You Up'],
				['9bZkp7q19f0', 'GANGNAM STYLE'],
				['kJQP7kiw5Fk', 'Despacito'],
				['JGwWNGJdvx8', 'Shape of You'],
				['OPf0YbXqDm0', 'Uptown Funk'],
			]);
			// The seat, its sheet shut; then multi:ride-session-deck — the sheet
			// open, its transport and queue at riding size (#3927); then
			// multi:ride-session-deck-playlists — the queue saved, and that
			// playlist open in the sheet.
			await s.shot(coach);
			// multi:ride-session-flat-wide — the same frame in a wide desk
			// window, where the panels had stretched across it (#4159).
			await coach.page.setViewportSize({ width: 2000, height: 1150 });
			await coach.page.waitForTimeout(500);
			await s.shot(coach, { name: 'ride-session-flat-wide' });
			await coach.page.setViewportSize(DESK.viewport!);
			await fold.click();
			await s.shot(coach, { name: 'ride-session-deck' });
			await coach.page
				.getByRole('button', { name: 'Save as a playlist' })
				.click();
			// Its "saved" toast is the app's, not the sheet's: dismissed.
			await coach.page.getByRole('button', { name: 'Dismiss' }).first().click();
			await coach.page.locator('summary', { hasText: /^playlists$/ }).click();
			const show = coach.page
				.getByRole('button', { name: 'show tracks' })
				.first();
			await show.click();
			await coach.page
				.getByRole('button', { name: 'hide tracks' })
				.first()
				.scrollIntoViewIfNeeded();
			await s.shot(coach, { name: 'ride-session-deck-playlists' });
			await fold.click();
			for (const [device, name] of variants([
				[DESK, 'ride-watch'],
				[PHONE, 'ride-watch-phone'],
			] as const)) {
				const watcher = await s.open(device, { as: 'Design Watcher' });
				await watcher.page.goto(voicePath(crew));
				const watch = watcher.page.getByRole('link', {
					name: 'Watch the session',
				});
				if (await watch.isVisible({ timeout: 5000 }).catch(() => false))
					await watch.click();
				await watcher.page.waitForTimeout(3000);
				await s.shot(watcher, { name });
			}
			await atSecond(coach.page, 70);
		} finally {
			await endSession(coach.page);
		}
		await coach.page
			.getByRole('dialog', { name: 'Session summary' })
			.waitFor({ timeout: 30_000 });
		// The ride's link lands once the save does: shoot the card with it.
		await coach.page
			.getByRole('link', { name: 'See your ride' })
			.waitFor({ timeout: 30_000 })
			.catch(() => {});
		await coach.page.waitForTimeout(1500);
		// probe:closing-card — the card's box against the window, and the dead
		// band at the bottom of the recap-trace panel (G3: none over 24 px).
		const extra = await coach.page.evaluate(() => {
			const box = (el: Element | null) => {
				const r = el?.getBoundingClientRect();
				return r && { left: r.left, width: r.width, top: r.top };
			};
			const panel = document.querySelector('[data-testid=recap-trace]');
			const last = panel?.lastElementChild?.getBoundingClientRect();
			const pad = panel ? parseFloat(getComputedStyle(panel).paddingBottom) : 0;
			return {
				card: box(document.querySelector('[data-testid=session-card]')),
				sidebarRight: document.querySelector('aside')?.getBoundingClientRect()
					.right,
				deadBand:
					panel && last
						? Math.round(
								panel.getBoundingClientRect().bottom - last.bottom - pad,
							)
						: null,
			};
		});
		await s.shot(coach, { name: 'closing-card-session', extra });
		// ux.md phone width: the same card at 375 × 812.
		await coach.page.setViewportSize({ width: 375, height: 812 });
		await coach.page.waitForTimeout(800);
		// probe:phoneOrder — [multi:reduced-motion] item 13: the card's blocks top to bottom.
		const phoneOrder = await coach.page.evaluate(() =>
			[
				...document.querySelectorAll(
					'[data-testid=closing-card] h1, [data-testid=closing-card] h2, [data-testid=closing-card] [data-testid=recap-tiles]',
				),
			].map((e) => ({
				block: e.getAttribute('data-testid') ?? e.textContent?.trim(),
				top: Math.round(e.getBoundingClientRect().top),
			})),
		);
		await s.shot(coach, {
			name: 'closing-card-session-phone',
			full: true,
			extra: { phoneOrder },
		});
	},
	{ also: ['ride-watch', 'closing-card-session'] },
);

/**
 * Five riders this device has set away from 100 %, on top of the shoot's
 * muted mix: the Sound sheet lists three and folds two (#4170).
 */
const MOVED_RIDERS = () => {
	const mix = JSON.parse(localStorage.getItem('wattroom.mixer.v1') ?? '{}');
	localStorage.setItem(
		'wattroom.mixer.v1',
		JSON.stringify({
			...mix,
			riders: { a: 0.75, b: 0.74, c: 0.69, d: 0.46, e: 1.3 },
			names: { a: 'Ana', b: 'Ben', c: 'Cleo', d: 'Dino', e: 'Eva' },
		}),
	);
};

/** The Sound sheet's own measurements: the page-wide probe cannot attribute them. */
async function soundSheet(page: Page) {
	await page
		.getByRole('button', { name: /^sound — the mix/ })
		.first()
		.click({ timeout: 15_000 });
	const dialog = page.getByRole('dialog', { name: /^Sound/ });
	await dialog.waitFor();
	await page.waitForTimeout(500);
	return async () => ({
		dialogTargets: await dialog.evaluate((el) => {
			const high = (e: Element) =>
				Math.round(e.getBoundingClientRect().height * 10) / 10;
			const r = el.getBoundingClientRect();
			// The bike computer's head on a ride: the sheet's top clears it.
			const head = document
				.querySelector('[data-testid=computer-head]')
				?.getBoundingClientRect();
			return {
				box: {
					left: r.left,
					top: r.top,
					bottom: innerHeight - r.bottom,
					width: r.width,
					height: r.height,
				},
				headBottom: head ? Math.round(head.bottom) : null,
				sliders: [...el.querySelectorAll('input[type=range]')].map(high),
				done: high(
					[...el.querySelectorAll('button')].find(
						(b) => b.textContent?.trim() === 'Done',
					)!,
				),
				selects: [...el.querySelectorAll('[role=combobox]')].map((e) => {
					const s = e.getBoundingClientRect();
					return { x: Math.round(s.x), width: Math.round(s.width) };
				}),
				scrollHeight: el.scrollHeight,
				clientHeight: el.clientHeight,
			};
		}),
	});
}

surface(
	'sound-dialog',
	async (s) => {
		// The Sound sheet as a rider opens it mid-ride (#4170): over a flat crew
		// session, at 1440 × 900 and at 2000 × 1150; then a phone's, from a voice
		// channel; then /settings/voice, which draws the same faders at desk size.
		const { coach, crew } = await session(
			s,
			{ workout: 'Recovery Spin' },
			false,
			async (o) => {
				await o.ctx.addInitScript(MOVED_RIDERS);
			},
		);
		try {
			await assertRiding(coach.page);
			const measure = await soundSheet(coach.page);
			await s.shot(coach, { name: 'sound-dialog', extra: await measure() });
			await coach.page.setViewportSize({ width: 2000, height: 1150 });
			await coach.page.waitForTimeout(800);
			await s.shot(coach, {
				name: 'sound-dialog-wide',
				extra: await measure(),
			});
			await coach.page.keyboard.press('Escape');
		} finally {
			await endSession(coach.page);
		}
		for (const [device, name] of variants([
			[PHONE, 'phone-sound-dialog'],
		] as const)) {
			const phone = await s.open(device);
			await phone.ctx.addInitScript(MOVED_RIDERS);
			await phone.page.goto(voicePath(crew));
			await phone.page
				.getByRole('button', { name: 'open navigation' })
				.first()
				.click({ timeout: 15_000 });
			const measure = await soundSheet(phone.page);
			await s.shot(phone, { name, extra: await measure() });
		}
		const desk = await s.open(DESK);
		await page(s, desk, '/settings/voice', {
			name: 'sound-dialog-settings-voice',
		});
	},
	{ also: ['phone-sound-dialog'] },
);

surface(
	'ride-session-road',
	async (s) => {
		const { coach } = await session(s, { road: ROADS.hairpin.name }, true);
		try {
			await assertRiding(coach.page, true);
			await s.shot(coach);
			// A cheer for one rider (#3116), from their crew tile's menu: it rides
			// the next tick, then the thumb holds 2.4 s and the light blinks 10 s.
			await coach.page
				.getByTestId('crew-tile')
				.filter({ hasText: 'Design Partner' })
				.click({ button: 'right' });
			await s.shot(coach, { name: 'ride-session-cheer-menu' });
			await coach.page
				.getByRole('menuitem', { name: 'Cheer Design Partner' })
				.click();
			await coach.page.waitForTimeout(1200);
			await s.shot(coach, { name: 'ride-session-cheer' });
			// A sprint armed (D12, #3668): over the world, its moment card, top-
			// centre where it fits and under the seat where it does not.
			await coach.page.getByRole('button', { name: 'arm a sprint' }).click();
			await coach.page.getByTestId('moment-card').waitFor({ timeout: 10_000 });
			await coach.page.waitForTimeout(500);
			await s.shot(coach, { name: 'ride-session-sprint' });
			// The window open: the card's border is watt while it is live.
			await coach.page
				.locator('[data-testid=moment-card][data-phase=live]')
				.waitFor({ timeout: 30_000 });
			await coach.page.waitForTimeout(500);
			await s.shot(coach, { name: 'ride-session-sprint-live' });
		} finally {
			await endSession(coach.page);
		}
	},
	// Both schemes: the ride keeps the rider's, on the session where the
	// cave used to darken the whole app (G1, #4160).
);

surface(
	'roadside-chalk',
	async (s) => {
		// Design Watcher at the roadside of Designer's session on the hairpin road
		// (#3029). The deck chalks halfway up the next climb, out of the chase
		// camera's sight, so the watcher's socket lays one 18 m ahead for the
		// world's shot, as the hub takes it from any deck.
		const { coach, crew } = await session(
			s,
			{ road: ROADS.hairpin.name },
			true,
		);
		try {
			const watcher = await s.open(DESK, { as: 'Design Watcher' });
			let socket: WebSocketRoute | undefined;
			await watcher.page.routeWebSocket(/\/ws\/channels\//, (ws) => {
				socket = ws.connectToServer();
			});
			await watcher.page.goto(voicePath(crew));
			await watcher.page
				.getByRole('button', { name: 'Chalk Allez' })
				.waitFor({ timeout: 20_000 });
			// The deck sits low on the page: its last line in view for each shot.
			await watcher.page
				.getByRole('group', { name: 'chalk the next climb' })
				.scrollIntoViewIfNeeded();
			await s.shot(watcher);
			// The same deck on a phone propped beside the bike (SPEC "The roadside").
			const phone = await s.open(PHONE, { as: 'Design Watcher' });
			await phone.page.goto(voicePath(crew));
			await phone.page
				.getByRole('group', { name: 'chalk the next climb' })
				.scrollIntoViewIfNeeded({ timeout: 20_000 });
			await s.shot(phone, { name: 'roadside-chalk-phone' });
			// A double tap while the climb is still open: the second stamp,
			// inside the hub's quarter second, is refused, and the deck says why
			// and when to try again. Both at the road's start, behind the bunch,
			// so neither lands: the screen lags the hub.
			const behind = JSON.stringify({
				roadside: { kind: 'paint', stamp: 'hopp', atM: 0 },
			});
			socket?.send(behind);
			socket?.send(behind);
			await watcher.page
				.getByRole('status')
				.filter({ hasText: 'One thing at a time' })
				.scrollIntoViewIfNeeded();
			await s.shot(watcher, { name: 'roadside-chalk-refused' });
			// The hub takes one roadside verb a quarter second (controlMinGap).
			await watcher.page.waitForTimeout(1000);
			// The heart goes 60 m past the bunch's front as it is now. The
			// world's canvas holds the riders as of its last frame, with the
			// speed they ride at; a software-GL shot takes seconds, so that
			// reading is carried on to this moment, and the hub refuses a chalk
			// that lands behind its front.
			// A refused heart (the front moved past it) is laid again from a
			// fresh reading, until the deck says the climb is spent.
			let front = NaN;
			let landed = false;
			for (let attempt = 0; attempt < 4 && !landed; attempt++) {
				front = await coach.page.evaluate(() => {
					const canvas = document.querySelector<HTMLCanvasElement>(
						'canvas[data-riders]',
					);
					const seen = JSON.parse(canvas?.dataset.riders ?? '{}');
					const lead = Math.max(
						...(seen.riders ?? []).map((r: { d: number }) => r.d),
					);
					return lead + ((seen.mps ?? 0) * (Date.now() - seen.t)) / 1000;
				});
				if (Number.isFinite(front)) {
					socket?.send(
						JSON.stringify({
							roadside: { kind: 'paint', stamp: 'heart', atM: front + 60 },
						}),
					);
				}
				landed = await watcher.page
					.getByText('No climb left ahead to chalk.')
					.waitFor({ timeout: 5_000 })
					.then(() => true)
					.catch(() => false);
			}
			if (!landed)
				throw new Error(
					`the heart never landed on the climb; last front ${front}`,
				);
			// The riders pass the chalk, and the hub lets it go: a shot on
			// software GL can outlast the heart's few seconds. So the spent
			// shot comes first, then the world's.
			await watcher.page
				.getByText('No climb left ahead to chalk.')
				.scrollIntoViewIfNeeded();
			await s.shot(watcher, { name: 'roadside-chalk-spent' });
			await s.shot(coach, { name: 'roadside-chalk-world' });
		} finally {
			await endSession(coach.page);
		}
	},
	{ once: true },
);

surface(
	'ride-race',
	async (s) => {
		// Designer and Design Partner race the hairpin road (#3174), started
		// from the session picker's Race it (#3777). The 3-minute neutral zone
		// alone is most of the default 5 minutes.
		test.setTimeout(10 * 60_000);
		const coach = await s.open(DESK, { world: false });
		const crew = await designCrew(coach.page);
		await fixtureRoad(coach.page, 'hairpin');
		const rider = await s.open(DESK, { as: 'Design Partner', world: false });
		await toTraining(coach.page, crew);
		// A run that failed mid-race left it running: end it first.
		if (
			await coach.page.getByRole('button', { name: 'end the session' }).count()
		) {
			await endSession(coach.page);
			await toTraining(coach.page, crew);
		}
		await toTraining(rider.page, crew);
		await startSession(coach.page, { road: ROADS.hairpin.name, race: 'Race' });
		await joinSession(rider.page);
		// Started "without a trainer", the coach lines up as the partner does.
		const coachJoins = coach.page.getByRole('link', { name: 'Join the ride' });
		if (await coachJoins.isVisible({ timeout: 5000 }).catch(() => false))
			await coachJoins.click();
		try {
			await coach.page.getByTestId('race-radio').waitFor({ timeout: 40_000 });
			// Docked, the arrows name the page they turn to (D15); RACE is last,
			// so ← from RIDE reaches it, and → from RACE comes back.
			await coach.page
				.getByRole('button', { name: 'previous page, RACE' })
				.click();
			// Through the 3-minute neutral zone to km 0, then 20 s of racing.
			await coach.page.waitForFunction(
				() =>
					/[+−]\d+:\d\d/.test(
						document.querySelector('[data-field="par"]')?.textContent ?? '',
					),
				null,
				{ timeout: 240_000 },
			);
			await coach.page.waitForTimeout(20_000);
			await s.shot(coach);
			// multi:ride-race-ride — the same race on RIDE: a page turn keeps the
			// computer's shape (ADR-0071).
			await coach.page.getByRole('button', { name: 'next page, RIDE' }).click();
			await coach.page.waitForTimeout(1000);
			await s.shot(coach, { name: 'ride-race-ride' });
			// multi:ride-race-map — the race's road from above (#3778): a race has
			// its road on every screen, so MAP is among its pages.
			const computer = coach.page.getByTestId('bike-computer');
			for (let turn = 0; turn < 4; turn++) {
				if ((await computer.getAttribute('data-page')) === 'map') break;
				await coach.page.getByRole('button', { name: /^next page, / }).click();
			}
			await coach.page
				.locator('[data-testid="bike-computer"][data-page="map"]')
				.waitFor({ timeout: 5000 });
			await coach.page.waitForTimeout(1000);
			await s.shot(coach, { name: 'ride-race-map' });
		} finally {
			await endSession(coach.page);
		}
	},
	{ once: true },
);

/**
 * A game on the hairpin road (#3114): Designer coaching, Design Partner riding
 * along, both on simulated trainers. No screen starts a game on a road yet
 * (#3794), so the coach's socket sends the start the hub takes.
 */
async function gameOnRoad(s: Shoot, mode: string, fromM = 0) {
	// Its shots wait up to 3:20 of riding, most of the default 5 minutes.
	test.setTimeout(10 * 60_000);
	const coach = await s.open(DESK, { world: true });
	const crew = await designCrew(coach.page);
	const road = await fixtureRoad(coach.page, 'hairpin');
	const rider = await s.open(DESK, { as: 'Design Partner', world: true });
	let socket: WebSocketRoute | undefined;
	await coach.page.routeWebSocket(/\/ws\/channels\//, (ws) => {
		socket = ws.connectToServer();
	});
	await toTraining(coach.page, crew);
	const open = coach.page.getByRole('button', { name: 'end the session' });
	if (await open.count()) {
		await endSession(coach.page);
		await toTraining(coach.page, crew);
	}
	await toTraining(rider.page, crew);
	// Sent until the session opens: a page that reconnected has a new socket.
	const start = JSON.stringify({
		control: { action: 'game', gameMode: mode, route: { id: road, fromM } },
	});
	for (let k = 0; k < 5 && !(await open.count()); k++) {
		socket?.send(start);
		await open.waitFor({ timeout: 4000 }).catch(() => {});
	}
	await joinSession(rider.page);
	// The game opened its session with the coach riding it, on the ride's own screen.
	await coach.page
		.getByRole('link', { name: 'Go to the ride' })
		.click({ timeout: 15_000 });
	return { coach, rider };
}

surface(
	'ride-game-backyard',
	async (s) => {
		const { coach } = await gameOnRoad(s, 'backyard-ramp');
		try {
			await atRoundSecond(coach.page, RIDE_SECOND);
			await assertRiding(coach.page, true);
			await s.shot(coach);
			// The round's last half minute: the next round's arch is near.
			await atRoundSecond(coach.page, 165);
			await s.shot(coach, { name: 'ride-game-backyard-arch' });
		} finally {
			await endSession(coach.page);
		}
	},
	{ once: true },
);

surface(
	'ride-game-collective',
	async (s) => {
		// Started up the hairpins, so the valley the fog fills lies below the bunch.
		const { coach } = await gameOnRoad(s, 'collective-ramp', 3500);
		try {
			// Into round 2: the fog has risen once.
			await atRoundSecond(coach.page, 200);
			await assertRiding(coach.page, true);
			await s.shot(coach);
		} finally {
			await endSession(coach.page);
		}
	},
	{ once: true },
);

surface('ride-detail', async (s) => {
	for (const [device, suffix] of variants([
		[DESK, ''],
		[PHONE, '-phone'],
	] as const)) {
		const o = await s.open(device);
		const road = await fixtureRoad(o.page, 'hairpin');
		await page(s, o, `/history/${await savedRide(o.page)}`, {
			name: `ride-detail${suffix}`,
		});
		await page(s, o, `/history/${await savedRide(o.page, road)}`, {
			name: `ride-detail-road${suffix}`,
		});
	}
	// A crew session's ride on a road (#3738): the session saves it with its
	// road, so its page draws the road as a solo road ride's does. No world:
	// the session is here for the ride it saves, past the minute one is kept.
	const started = Date.now() - 5_000;
	const { coach, rider } = await session(
		s,
		{ road: ROADS.hairpin.name },
		false,
	);
	try {
		await coach.page.waitForTimeout(70_000);
	} finally {
		await endSession(coach.page);
	}
	await coach.page
		.getByRole('dialog', { name: 'Session summary' })
		.waitFor({ timeout: 30_000 });
	await page(s, coach, `/history/${await newestRide(coach.page, started)}`, {
		name: 'ride-detail-session-road',
	});
	// The same session's ride for the rider whose road it is not (#3874,
	// ADR-0063): the road's generated name, never its owner's.
	await page(s, rider, `/history/${await newestRide(rider.page, started)}`, {
		name: 'ride-detail-session-road-rider',
	});
});
