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
import { probe, type Box } from './probe';

/**
 * How the design shots open a browser, ride, and write a shot (#3666). The
 * spec says which surface; this says how every one of them is taken.
 */

export const OUT = process.env.DESIGN_SHOTS_OUT ?? '';
export const SCHEME: 'dark' | 'light' =
	process.env.DESIGN_SHOTS_SCHEME === 'light' ? 'light' : 'dark';
const ONLY = (process.env.DESIGN_SHOTS_SURFACES ?? '')
	.split(/[\s,]+/)
	.filter(Boolean);
export const wanted = (id: string) => ONLY.length === 0 || ONLY.includes(id);

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
export const TV: BrowserContextOptions = {
	viewport: { width: 1920, height: 1080 },
};
export const HUD_SHELL = { width: 320, height: 132 };

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
	constructor(
		private readonly browser: Browser,
		readonly id: string,
	) {}

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
			baseURL: process.env.PLAYWRIGHT_BASE_URL,
			// A surface whose recipe fixes the OS scheme keeps it (ride-free-road).
			colorScheme: device.colorScheme ?? SCHEME,
			reducedMotion,
		});
		await ctx.addInitScript(
			([muted, world]) => {
				localStorage.setItem('wattroom.mixer.v1', muted);
				// World on is the device's World control at Full: this flag until
				// #3214 replaces it.
				if (world === true) localStorage.setItem('wattroom.world-slot.v1', '1');
				if (world === false) localStorage.removeItem('wattroom.world-slot.v1');
			},
			[MUTED, world ?? null] as const,
		);
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
		{ name = this.id, full = false }: { name?: string; full?: boolean } = {},
	): Promise<void> {
		const wholeDocument = full && !(await growToBody(page));
		const probes = await page.evaluate(probe, CORRIDOR);
		await page.screenshot({
			path: join(OUT, `${name}.png`),
			fullPage: wholeDocument,
		});
		await writeFile(
			join(OUT, `${name}.json`),
			JSON.stringify({ ...probes, pageErrors: errors }, null, 2) + '\n',
		);
	}

	/** A failure: the page it happened on, and why — never a shot of the page before. */
	async failed(error: unknown): Promise<void> {
		const last = this.opened.at(-1);
		const message = error instanceof Error ? error.message : String(error);
		await writeFile(join(OUT, `FAILED-${this.id}.txt`), message + '\n');
		await last?.page
			.screenshot({ path: join(OUT, `FAILED-${this.id}.png`) })
			.catch(() => {});
	}

	async close(): Promise<void> {
		for (const { ctx } of this.opened) await ctx.close().catch(() => {});
	}

	/** Clears what an earlier run left under this surface's name. */
	async clean(): Promise<void> {
		await mkdir(OUT, { recursive: true });
		for (const stale of [`FAILED-${this.id}.png`, `FAILED-${this.id}.txt`])
			await rm(join(OUT, stale), { force: true });
	}
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

/** Every clock-shaped reading on the page, joined. */
// A read that lands mid-navigation counts as no clock yet, not a failure.
const clocks = (page: Page) =>
	page
		.evaluate(() =>
			(document.body.innerText.match(/\b\d{1,2}:\d{2}\b/g) ?? []).join(' '),
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
	const start = page
		.getByRole('button', { name: /^Start (riding|the ride)$/ })
		.first();
	// A road left short of its end offers to carry on (#3205): every shot
	// starts from km 0, whatever an earlier run saved.
	const fromStart = page.getByRole('button', { name: 'From the start' });
	await start.or(fromStart).first().waitFor({ timeout: 15_000 });
	if (await fromStart.isVisible()) {
		await fromStart.click();
		await start.waitFor({ timeout: 5000 }).catch(() => {});
	}
	if (await start.isVisible()) await start.click();
	await atSecond(page, second);
}

/** Waits until a clock on the page reads `second` into the ride. */
export async function atSecond(page: Page, second: number): Promise<void> {
	const mark = `${Math.floor(second / 60)}:${String(second % 60).padStart(2, '0')}`;
	const deadline = Date.now() + (second + 30) * 1000;
	while (!(await clocks(page)).split(' ').includes(mark)) {
		if (Date.now() > deadline)
			throw new Error(`the ride never reached ${mark}: ${await clocks(page)}`);
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
