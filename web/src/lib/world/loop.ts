/**
 * The world's frame clock (#3078, docs/SPEC.md "The world"): 30 fps on the
 * display's own vsync divisor — every 2nd frame at 60 Hz, 4th at 120, 5th at
 * 144, 6th at 165 — one frame a second while nothing moves, and none while
 * any gate is shut. The divisor intervals that pass without a frame are
 * counted: that, not the JS time of render(), is what rideView() falls back
 * to the Skyline on (ADR-0066, #3080).
 */

export const FPS = 30;
/** A frame a second while nothing moves. */
export const IDLE_MS = 1000;

/**
 * How many display frames make one of ours: never above 30 fps, so 144 Hz
 * takes 5 and 165 Hz takes 6. The tenth of slack keeps a display measured at
 * 60.2 Hz on 2.
 */
export const divisorFor = (hz: number): number =>
	Math.max(1, Math.ceil(hz / FPS - 0.1));

export type LoopStats = {
	rendered: number;
	/** Divisor intervals that passed without a frame, idle and shut gates excepted. */
	missed: number;
	hz: number;
};

/**
 * The display's frame period: the mean of the fastest cluster of deltas, so
 * vsync jitter averages out and a delta that spans two vsyncs is left out.
 */
function periodOf(deltas: number[]): number {
	const floor = Math.min(...deltas) * 1.5;
	let sum = 0;
	let n = 0;
	for (const d of deltas) if (d < floor) ((sum += d), n++);
	return sum / n;
}

/** Decides, animation frame by animation frame, whether this one renders. */
export function createPacer() {
	const deltas: number[] = [];
	let last = -1;
	let period = 1000 / 60;
	let phase = 0; // vsyncs since the grid last began
	let slot = 0; // the grid interval that last rendered
	let rendered = 0;
	let missed = 0;
	let wasIdle = false;
	let drew = false;
	function begin(render: boolean) {
		phase = 0;
		slot = 0;
		if (render) rendered++;
		return (drew = render);
	}
	return {
		/** `now`: the animation frame's timestamp, ms. */
		tick(now: number, idle = false): boolean {
			const delta = now - last;
			const first = last < 0;
			last = now;
			if (first) return begin(true);
			// Only a delta after a frame that drew nothing measures the display:
			// one after a render carries the render's cost, and a world that
			// only ever makes 20 fps would otherwise teach it a 20 Hz display.
			if (!drew && delta > 0 && delta < 100) {
				deltas.push(delta);
				if (deltas.length > 60) deltas.shift();
				period = periodOf(deltas);
			}
			if (idle !== wasIdle) {
				wasIdle = idle;
				return begin(!idle); // waking draws at once; dozing off just drew
			}
			phase += Math.max(1, Math.round(delta / period));
			const every = idle
				? Math.round(IDLE_MS / period)
				: divisorFor(1000 / period);
			const at = Math.floor(phase / every);
			if (at === slot) return (drew = false);
			// Every interval the grid passed without a frame is a miss.
			if (!idle) missed += at - slot - 1;
			slot = at;
			rendered++;
			return (drew = true);
		},
		/** After a hold: the time it lasted is not a missed frame. */
		resume() {
			last = -1;
		},
		stats(): LoopStats {
			return { rendered, missed, hz: 1000 / period };
		},
	};
}

/**
 * Why the world is not drawing: the tab is hidden, the canvas is off screen,
 * a shared screen has its place, the desktop shell put its window away.
 */
export type Gate = 'hidden' | 'offscreen' | 'displaced' | 'shell';

type Frames = {
	request: (cb: (now: number) => void) => number;
	cancel: (id: number) => void;
};

const browserFrames: Frames = {
	request: (cb) => requestAnimationFrame(cb),
	cancel: (id) => cancelAnimationFrame(id),
};

/**
 * The loop: `draw(seconds)` on the frames the pacer picks, from start() and
 * while every gate is open. `idle()` is asked each frame whether anything moves.
 */
export function createLoop(
	draw: (seconds: number) => void,
	idle: () => boolean,
	frames: Frames = browserFrames,
) {
	const pacer = createPacer();
	const shut = new Set<Gate>();
	let id = 0;
	let running = false;
	let stopped = true; // until start(): the gates may report before the first frame is ready
	let since = -1;
	function frame(now: number) {
		id = frames.request(frame);
		if (!pacer.tick(now, idle())) return;
		const seconds = since < 0 ? 0 : (now - since) / 1000;
		since = now;
		draw(seconds);
	}
	function sync() {
		const go = !stopped && shut.size === 0;
		if (go === running) return;
		running = go;
		if (go) {
			pacer.resume();
			since = -1;
			id = frames.request(frame);
		} else frames.cancel(id);
	}
	return {
		gate(gate: Gate, closed: boolean) {
			if (closed) shut.add(gate);
			else shut.delete(gate);
			sync();
		},
		get running() {
			return running;
		},
		stats: pacer.stats,
		start() {
			stopped = false;
			sync();
		},
		stop() {
			stopped = true;
			sync();
		},
	};
}

/** The gates the page can see for itself: the tab hidden, the canvas off screen. */
export function watchPage(
	canvas: HTMLCanvasElement,
	gate: (g: Gate, closed: boolean) => void,
	IO: typeof IntersectionObserver | undefined = globalThis.IntersectionObserver,
): () => void {
	const onVisibility = () => gate('hidden', document.hidden);
	document.addEventListener('visibilitychange', onVisibility);
	onVisibility();
	const io = IO
		? new IO((entries) => {
				for (const e of entries) gate('offscreen', !e.isIntersecting);
			})
		: null;
	io?.observe(canvas);
	return () => {
		document.removeEventListener('visibilitychange', onVisibility);
		io?.disconnect();
	};
}
