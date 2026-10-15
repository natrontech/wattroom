import type { Page } from '@playwright/test';

type Hooks = { __hold: () => void; __tick: () => void };

/**
 * A held count-in: the world takes longer to build than the 3 s count-in
 * lasts. Call this before the page loads, `hold()` before Start, and the
 * ticker (its worker ticks on real time) fires only when `tick()` is
 * called, with Date.now frozen so one tick is one second.
 */
export async function holdCountIn(page: Page) {
	await page.addInitScript(() => {
		const w = window as unknown as Hooks;
		// The ticker's own worker is replaced by a stub; the world's stay real.
		const tickerUrls = new Set<string>();
		const ticks: (() => void)[] = [];
		const real = Date.now.bind(Date);
		const RealBlob = window.Blob;
		const tickerBlobs = new WeakSet<Blob>();
		window.Blob = class extends RealBlob {
			constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
				super(parts, options);
				if (String(parts?.[0]).includes('postMessage(0)'))
					tickerBlobs.add(this);
			}
		};
		const makeUrl = URL.createObjectURL.bind(URL);
		URL.createObjectURL = (obj) => {
			const url = makeUrl(obj);
			if (tickerBlobs.has(obj as Blob)) tickerUrls.add(url);
			return url;
		};
		const RealWorker = window.Worker;
		window.Worker = new Proxy(RealWorker, {
			construct: (target, args) =>
				tickerUrls.has(String(args[0]))
					? ({
							postMessage() {},
							terminate() {},
							set onmessage(fn: () => void) {
								ticks.push(fn);
							},
						} as unknown as Worker)
					: Reflect.construct(target, args),
		});
		let frozen: number | null = null;
		Date.now = () => frozen ?? real();
		w.__hold = () => {
			frozen = real();
		};
		w.__tick = () => ticks.forEach((fn) => fn());
	});
	return {
		hold: () => page.evaluate(() => (window as unknown as Hooks).__hold()),
		tick: () => page.evaluate(() => (window as unknown as Hooks).__tick()),
	};
}
