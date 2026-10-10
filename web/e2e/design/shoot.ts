import {
	devices,
	type Browser,
	type BrowserContext,
	type BrowserContextOptions,
	type Page,
} from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { baseUrl } from '../env.js';
import { probe, sampleAt, type Box } from './probe';

/**
 * How the design shots open a browser, ride, and write a shot (#3666). The
 * spec says which surface; this says how every one of them is taken.
 */

export const OUT = process.env.DESIGN_SHOTS_OUT ?? '';
export type Scheme = 'dark' | 'light';
/** DESIGN_SHOTS_SCHEME: dark, light or both (the default). */
export const SCHEMES: Scheme[] =
	process.env.DESIGN_SHOTS_SCHEME === 'dark'
		? ['dark']
		: process.env.DESIGN_SHOTS_SCHEME === 'light'
			? ['light']
			: ['dark', 'light'];
const ONLY = (process.env.DESIGN_SHOTS_SURFACES ?? '')
	.split(/[\s,]+/)
	.filter(Boolean);
// DESIGN_SHOTS_EXCEPT: the surfaces other CI shards take (design-shots.yml),
// so the shard that names none still gets any surface added later.
const EXCEPT = (process.env.DESIGN_SHOTS_EXCEPT ?? '')
	.split(/[\s,]+/)
	.filter(Boolean);
/** A test is wanted when any surface id it captures is named, or none is, and none is excepted. */
export const wanted = (ids: readonly string[]) =>
	(ONLY.length === 0 || ids.some((id) => ONLY.includes(id))) &&
	!ids.some((id) => EXCEPT.includes(id));

export const DESK: BrowserContextOptions = {
	viewport: { width: 1440, height: 900 },
};
// A real phone profile, not a narrow desktop: device.svelte.ts reads pointer
// and Bluetooth signals, not width alone, and the Watch view is a phone's
// (#412). The standard is 375 × 812 at 1× (ux.md), so a shot is 375 px wide.
export const PHONE: BrowserContextOptions = {
	...devices['Pixel 5'],
	viewport: { width: 375, height: 812 },
	deviceScaleFactor: 1,
};
// A phone that rides (#3854): Chrome on Android, which a Pixel 5 runs, has
// Web Bluetooth, and a phone with it is no spectator (device.svelte.ts;
// ADR-0066: "A phone with Web Bluetooth rides"). PHONE stays the phone that
// cannot, the one a Watch view is for. Headless Chromium on Linux lacks the
// API, so this profile is lent its presence (`lendBluetooth`); every ride
// here is the simulated trainer's, and nothing pairs through it.
export const RIDING_PHONE: BrowserContextOptions = { ...PHONE };
export const DESK_720: BrowserContextOptions = {
	viewport: { width: 1280, height: 720 },
};
export const TV: BrowserContextOptions = {
	viewport: { width: 1920, height: 1080 },
};
export const HUD_SHELL = { width: 320, height: 132 };
const SHOT_TIMEOUT_MS = 60_000;

/**
 * The TV and the phone are variants of a surface (#3858): a full run takes
 * them, a scoped one only when it names a TV or a phone surface, which the
 * surface map does when a TV or phone layout file changed.
 */
const named = (variant: string) =>
	ONLY.length === 0 ||
	ONLY.some((id) => new RegExp(`(^|-)${variant}(-|$)`).test(id));
const VARIANT = { tv: named('tv'), phone: named('phone') };
export const takes = (device: BrowserContextOptions) =>
	device === TV
		? VARIANT.tv
		: device === PHONE || device === RIDING_PHONE
			? VARIANT.phone
			: true;
/** The rows of a recipe's device list this run takes. */
export const variants = <
	T extends readonly [BrowserContextOptions, ...unknown[]],
>(
	rows: readonly T[],
): T[] => rows.filter(([device]) => takes(device));

/** A full-page shot grows the viewport to the page body, this far at most. */
const FULL_PAGE_CAP = 6000;
/** The ride second every riding shot is taken at. */
export const RIDE_SECOND = 14;

// The keep-clear corridor has one home, docks.ts; the probe reads it there.
const CORRIDOR: Box = JSON.parse(
	readFileSync(
		new URL('../../src/lib/session/docks.ts', import.meta.url),
		'utf8',
	)
		.match(/CORRIDOR: Box = (\{[^}]+\})/)![1]
		.replace(/(\w+):/g, '"$1":'),
);

const MUTED = JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 });

export interface Opened {
	ctx: BrowserContext;
	page: Page;
	errors: string[];
}

/**
 * One surface's run: the contexts it opens, so a failure can shoot the page it
 * was on and every context closes after.
 */
export class Shoot {
	private opened: Opened[] = [];
	/** Where this surface's shots go: the run's folder for its scheme. */
	readonly out: string;
	constructor(
		private readonly browser: Browser,
		readonly id: string,
		private readonly scheme: Scheme,
	) {
		this.out = join(OUT, scheme);
	}

	/** A fresh context, muted before any page mounts; signed in as `as`. */
	async open(
		device: BrowserContextOptions,
		{
			as = 'Designer',
			reducedMotion,
			world,
		}: {
			as?: string | null;
			reducedMotion?: 'reduce';
			world?: boolean;
		} = {},
	): Promise<Opened> {
		const ctx = await this.browser.newContext({
			...device,
			baseURL: baseUrl(),
			// A surface whose recipe fixes the OS scheme keeps it (ride-free-road).
			colorScheme: device.colorScheme ?? this.scheme,
			reducedMotion,
		});
		await ctx.addInitScript(
			([muted, world]) => {
				localStorage.setItem('wattroom.mixer.v1', muted);
				// World on is the device's World control at Full: this flag until
				// #3214 replaces it.
				if (world === true) localStorage.setItem('wattroom.world-slot.v1', '1');
				// Software GL misses every frame; the dev build's frame judge
				// stands down for the capture (#3823).
				localStorage.setItem('wattroom.world-software.v1', '1');
				if (world === false) localStorage.removeItem('wattroom.world-slot.v1');
			},
			[MUTED, world ?? null] as const,
		);
		if (device === RIDING_PHONE) await ctx.addInitScript(lendBluetooth);
		const page = await ctx.newPage();
		page.on('dialog', (d) => void d.accept());
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
		if (as) await page.goto(`/api/auth/dev/start?as=${encodeURIComponent(as)}`);
		const opened = { ctx, page, errors };
		this.opened.push(opened);
		return opened;
	}

	/** Writes `<name>.png` and its probes, `<name>.json`. */
	async shot(
		{ page, errors }: Pick<Opened, 'page' | 'errors'>,
		{
			name = this.id,
			full = false,
			extra = {},
		}: { name?: string; full?: boolean; extra?: object } = {},
	): Promise<void> {
		const wholeDocument = full && !(await growToBody(page));
		// The public site lazy-loads its media: walk the document once so a
		// whole-document shot shows what a reader scrolling it would see.
		if (wholeDocument) {
			await page.evaluate(async () => {
				for (
					let y = 0;
					y < document.documentElement.scrollHeight;
					y += innerHeight
				) {
					scrollTo(0, y);
					await new Promise((r) => setTimeout(r, 150));
				}
				scrollTo(0, 0);
			});
			await page.waitForTimeout(1000);
		}
		const probes = await page.evaluate(probe, CORRIDOR);
		// A world frame drawn in software GL on a loaded machine took longer
		// than the 15 s a control is given, and every frame after it was lost
		// (#3942); a shot waits for its frame, not for a click.
		const png = await page.screenshot({
			path: join(this.out, `${name}.png`),
			fullPage: wholeDocument,
			timeout: SHOT_TIMEOUT_MS,
		});
		const at = (probes as { asphaltAt?: [number, number] | null }).asphaltAt;
		const asphaltRgb =
			at && !wholeDocument
				? await page.evaluate(sampleAt, { png: png.toString('base64'), at })
				: null;
		await writeFile(
			join(this.out, `${name}.json`),
			JSON.stringify(
				{ ...probes, asphaltRgb, ...extra, pageErrors: errors },
				null,
				2,
			) + '\n',
		);
	}

	/** A failure: the page it happened on, and why — never a shot of the page before. */
	async failed(error: unknown): Promise<void> {
		const last = this.opened.at(-1);
		const message = error instanceof Error ? error.message : String(error);
		await writeFile(join(this.out, `FAILED-${this.id}.txt`), message + '\n');
		await last?.page
			.screenshot({ path: join(this.out, `FAILED-${this.id}.png`) })
			.catch(() => {});
	}

	async close(): Promise<void> {
		for (const { ctx } of this.opened) await ctx.close().catch(() => {});
	}

	/** Clears what an earlier run left under this surface's name. */
	async clean(): Promise<void> {
		await mkdir(this.out, { recursive: true });
		for (const stale of [`FAILED-${this.id}.png`, `FAILED-${this.id}.txt`])
			await rm(join(this.out, stale), { force: true });
	}
}

/**
 * Web Bluetooth where the browser has none, for RIDING_PHONE: the app asks
 * only whether it exists until a rider pairs, and a chooser opened here is
 * dismissed, as a rider would dismiss it.
 */
function lendBluetooth() {
	if ('bluetooth' in navigator) return;
	const bluetooth = {
		requestDevice: () =>
			Promise.reject(
				new DOMException('User cancelled the chooser.', 'NotFoundError'),
			),
	};
	Object.defineProperty(Navigator.prototype, 'bluetooth', {
		get: () => bluetooth,
		configurable: true,
	});
}

/**
 * Grows the viewport to the page body's height, so one shot holds the page;
 * false where there is no page body — the public site scrolls its document,
 * which a full-page screenshot takes whole.
 */
async function growToBody(page: Page): Promise<boolean> {
	const height = await page.evaluate(() => {
		const body = document.querySelector('[data-testid=page-body]');
		return body
			? Math.ceil(body.getBoundingClientRect().top + body.scrollHeight)
			: null;
	});
	if (height === null) return false;
	const { width, height: now } = page.viewportSize()!;
	if (height > now) {
		await page.setViewportSize({
			width,
			height: Math.min(height, FULL_PAGE_CAP),
		});
		await page.waitForTimeout(500);
	}
	return true;
}

/**
 * Every clock-shaped reading on the page, joined; a ghost's split (“+1:05”,
 * “−0:12”) is a difference, not a clock, and a seeded ride on the road puts
 * one on every road ride.
 */
// A read that lands mid-navigation counts as no clock yet, not a failure.
const clocks = (page: Page) =>
	page
		.evaluate(() =>
			(
				document.body.innerText.match(/(?<![+\u2212\d:])\d{1,2}:\d{2}\b/g) ?? []
			).join(' '),
		)
		.catch(() => '');

/**
 * Pairs the simulated trainer, starts, and waits for the ride's clock to reach
 * `second` — every riding shot is taken at the same ride second.
 */
export async function ride(
	page: Page,
	url: string,
	{ second = RIDE_SECOND }: { second?: number } = {},
): Promise<void> {
	await page.goto(url);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.first()
		.click({ timeout: 15_000 });
	// /ride's card, a road ride's too (#3855): a road left short of its end
	// offers to carry on as a chip, and the card opens on the url's `from`.
	await page
		.getByRole('button', { name: /^Start (riding|the ride)$/ })
		.first()
		.click({ timeout: 15_000 });
	await atSecond(page, second);
}

/**
 * Waits until a clock on the page reads `second` into the ride. A machine
 * that draws the world in software (#3823) answers a poll seconds late, so a
 * clock that has already moved on, by up to LATE seconds, counts as reached:
 * the shot is a little later in the ride, never a failed surface.
 */
const LATE = 45;
export async function atSecond(page: Page, second: number): Promise<void> {
	const mark = `${Math.floor(second / 60)}:${String(second % 60).padStart(2, '0')}`;
	const reached = (clock: string) => {
		const [m, s] = clock.split(':').map(Number);
		const at = m * 60 + s - second;
		return at >= 0 && at <= LATE;
	};
	const deadline = Date.now() + (second + 30 + LATE) * 1000;
	for (;;) {
		const shown = (await clocks(page)).split(' ');
		if (shown.includes(mark) || shown.some(reached)) return;
		if (Date.now() > deadline)
			throw new Error(`the ride never reached ${mark}: ${shown.join(' ')}`);
		await page.waitForTimeout(200);
	}
}

/**
 * Waits until the page reads `reading` — slot 1's "km 0.1 of 7.1" — for a
 * shot whose target is a distance, not a second (#3834). The dot moves by the
 * whole seconds between samples, held to two (road-ride.ts), so a machine
 * answering slowly reaches a clock mark with the road still behind it, and
 * at 83 W on 3 % the first 50 m arrive near the 14 s mark anyway. Bounded: a
 * reading that never comes is a failed shot with what the page said instead.
 */
export async function atReading(
	page: Page,
	reading: string,
	timeoutMs = 90_000,
): Promise<void> {
	const text = () =>
		page
			.evaluate(() => document.body.innerText.match(/km [\d.]+ of [\d.]+/)?.[0])
			.catch(() => undefined);
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const shown = await text();
		if (shown === reading) return;
		if (Date.now() > deadline)
			throw new Error(`the ride never read "${reading}": ${shown ?? 'no km'}`);
		await page.waitForTimeout(200);
	}
}

/**
 * A running ride: a clock on the page moves. Whether the frame is the cave is
 * G1's question and a probe, never an assertion — a ride that forgot the cave
 * is the defect the shot exists to show. `world`: drawn (true), must not be
 * (false), either (undefined).
 */
export async function assertRiding(page: Page, world?: boolean): Promise<void> {
	const first = await clocks(page);
	await page.waitForTimeout(2500);
	if (!first || first === (await clocks(page)))
		throw new Error(
			`the ride's clock did not advance (${first || 'no clock'})`,
		);
	if (world === undefined) return;
	const drawn = await page.evaluate(() => ({
		canvas: !!document.querySelector('canvas'),
		flat: document.body.innerText.match(/Flat road —[^\n]*/)?.[0] ?? null,
	}));
	if (world && (!drawn.canvas || drawn.flat))
		throw new Error(
			`the world did not draw: ${drawn.flat ?? 'no canvas mounted'}`,
		);
	if (!world && drawn.canvas)
		throw new Error('a world canvas mounted on a ride with no road');
}
