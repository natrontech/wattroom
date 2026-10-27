/**
 * An open mic that stopped sending without ending (#4220). A Bluetooth route
 * change can leave the capture track muted (no frames, never `ended`), or
 * stop the WebAudio graph the call is fed from, while the call itself plays
 * on: the rider hears everyone and nobody hears the rider, with nothing on
 * screen. Either one held for DEAD_MS is a dead mic; the chain then opens a
 * fresh capture.
 *
 * A hidden tab's graph is the browser's to suspend (#214): it resumes on
 * return, so a graph only counts while the page is visible.
 */

/** How long a muted capture or a stopped graph is given to come back. */
export const DEAD_MS = 2000;

/** The capture track's part: its frames stopping and starting. */
interface Capture {
	readonly muted: boolean;
	addEventListener(type: 'mute' | 'unmute', fn: () => void): void;
	removeEventListener(type: 'mute' | 'unmute', fn: () => void): void;
}

/** The graph's part: whether its audio thread runs. */
interface Graph {
	readonly state: string;
	resume(): Promise<void>;
	addEventListener(type: 'statechange', fn: () => void): void;
	removeEventListener(type: 'statechange', fn: () => void): void;
}

/** Watches one chain until the returned stop; `dead` fires once at most. */
export function watchMicHealth(
	{ capture, ctx }: { capture?: Capture; ctx: Graph | null },
	dead: () => void,
	visible: () => boolean = () =>
		typeof document === 'undefined' || document.visibilityState === 'visible',
): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let done = false;
	const stalled = () =>
		!!capture?.muted ||
		(!!ctx && ctx.state !== 'running' && ctx.state !== 'closed' && visible());

	function check() {
		if (done) return;
		if (!stalled()) {
			clearTimeout(timer);
			timer = undefined;
			return;
		}
		// A graph the browser stopped is asked to run again first.
		if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
		timer ??= setTimeout(() => {
			timer = undefined;
			if (done || !stalled()) return;
			done = true;
			dead();
		}, DEAD_MS);
	}

	capture?.addEventListener('mute', check);
	capture?.addEventListener('unmute', check);
	ctx?.addEventListener('statechange', check);
	check();
	return () => {
		done = true;
		clearTimeout(timer);
		capture?.removeEventListener('mute', check);
		capture?.removeEventListener('unmute', check);
		ctx?.removeEventListener('statechange', check);
	};
}
