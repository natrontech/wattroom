/**
 * The ride's tick source (#51).
 *
 * Not a bare `setInterval` on the main thread: Chrome throttles timers in a hidden
 * tab to roughly once a minute (RESEARCH.md §tab throttling), so a rider who
 * switches tabs mid-ride has their clock, their ERG targets and auto-pause all
 * stop. Riders in a room are incidentally protected by the WebRTC connection;
 * solo riders are not, which is exactly the case the workout player serves.
 *
 * Two halves, and both are load-bearing:
 *
 *   - A worker timer keeps firing while the tab is hidden, so targets stay fresh.
 *   - Every fire reports how many seconds *actually* passed, measured against the
 *     wall clock. If the worker is throttled anyway — a browser we have not
 *     measured, a CSP that blocks blob workers and drops us onto setInterval — the
 *     ride still advances by the right amount instead of by one.
 *
 * The second half is why this is correct rather than merely better.
 */

/**
 * Posts a message every `intervalMs`; any other message stops it. Kept to one line
 * of source because it ships as a blob — a separate module would need build config
 * on both Vite and vitest to buy nothing.
 */
const WORKER_SOURCE = `let i;onmessage=e=>{if(e.data>0){i=setInterval(()=>postMessage(0),e.data)}else{clearInterval(i);close()}}`;

export interface TickerOptions {
	intervalMs?: number;
	/** Injected so tests can drive the wall clock; defaults to real time. */
	now?: () => number;
}

export interface Ticker {
	/** Which mechanism is actually driving it — worth surfacing, since only one
	 *  of them survives a hidden tab. */
	readonly kind: 'worker' | 'timeout';
	stop(): void;
}

export function createTicker(
	onTick: (seconds: number) => void,
	{ intervalMs = 1000, now = Date.now }: TickerOptions = {},
): Ticker {
	let last = now();

	function fire() {
		const at = now();
		// At least one: a fire that arrives early must still advance the ride, and a
		// clock that jumps backwards (NTP correction, sleep) must not rewind it.
		const seconds = Math.max(1, Math.round((at - last) / intervalMs));
		last = at;
		onTick(seconds);
	}

	const worker = startWorker(intervalMs, fire);
	if (worker) return { kind: 'worker', stop: worker };

	const id = setInterval(fire, intervalMs);
	return { kind: 'timeout', stop: () => clearInterval(id) };
}

/** Returns a stop function, or null when workers are unavailable. */
function startWorker(
	intervalMs: number,
	fire: () => void,
): (() => void) | null {
	if (
		typeof Worker === 'undefined' ||
		typeof URL?.createObjectURL !== 'function'
	)
		return null;

	let url: string | undefined;
	try {
		url = URL.createObjectURL(
			new Blob([WORKER_SOURCE], { type: 'text/javascript' }),
		);
		const worker = new Worker(url);
		worker.onmessage = fire;
		worker.postMessage(intervalMs);
		return () => {
			worker.terminate();
			if (url) URL.revokeObjectURL(url);
		};
	} catch {
		// A CSP without blob: workers, or a browser that refuses. The main-thread
		// timer still runs the ride; it just throttles when hidden, which the
		// wall-clock delta then absorbs.
		if (url) URL.revokeObjectURL(url);
		return null;
	}
}
