/**
 * What held the page when the world dropped its frames: the longest animation
 * frames of the last seconds, from the browser's own Long Animation Frames
 * timing (Chromium 123+), each with the script that ran longest in it. The
 * line a fallback leaves in the console carries it, and the console is what a
 * mid-ride ⚑ report sends (flightrecorder.svelte.ts): the next "dropped
 * frames" names its stall instead of leaving it to be guessed (#4423).
 * Elsewhere it observes nothing and says nothing.
 */

/** One long frame, as the line names it. */
export type LongFrame = { at: number; ms: number; what: string };

/** How long the frames are kept: the fallback's window and a little. */
const KEEP_MS = 12_000;

type Script = {
	duration: number;
	invoker?: string;
	sourceURL?: string;
	sourceFunctionName?: string;
};

/** A script's name: its function and file, without the build's hash or query. */
export function scriptName(s: Script): string {
	const file = (s.sourceURL ?? '').split('/').pop()?.replace(/\?.*$/, '');
	const fn = s.sourceFunctionName || s.invoker || 'script';
	return file ? `${fn} (${file})` : fn;
}

/** The `n` longest of `frames`, longest first, as one short clause. */
export function describeLongFrames(
	frames: readonly LongFrame[],
	n = 3,
): string {
	if (frames.length === 0) return 'no long frames';
	return [...frames]
		.sort((a, b) => b.ms - a.ms)
		.slice(0, n)
		.map((f) => `${Math.round(f.ms)} ms in ${f.what}`)
		.join(', ');
}

export function watchLongFrames(): {
	recent(): LongFrame[];
	stop(): void;
} {
	let frames: LongFrame[] = [];
	let observer: PerformanceObserver | null = null;
	const supported =
		typeof PerformanceObserver !== 'undefined' &&
		PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame');
	if (supported) {
		observer = new PerformanceObserver((list) => {
			const now = performance.now();
			frames = frames.filter((f) => now - f.at < KEEP_MS);
			for (const e of list.getEntries()) {
				const scripts = (e as PerformanceEntry & { scripts?: Script[] })
					.scripts;
				const longest = scripts?.length
					? scripts.reduce((a, b) => (b.duration > a.duration ? b : a))
					: null;
				frames.push({
					at: e.startTime,
					ms: e.duration,
					what: longest ? scriptName(longest) : 'rendering',
				});
			}
		});
		observer.observe({ type: 'long-animation-frame' });
	}
	return {
		recent() {
			const now = performance.now();
			return frames.filter((f) => now - f.at < KEEP_MS);
		},
		stop() {
			observer?.disconnect();
			frames = [];
		},
	};
}
