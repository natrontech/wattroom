/**
 * The page's live handles, counted from before its first script (#3851): an
 * init script that wraps addEventListener, the timers and the animation
 * frames, so the soak can read how many are alive at once. Runs in the
 * browser, so it closes over nothing.
 *
 * A listener counts from its add to its remove, or until its target is
 * collected. One added with `once` or a `signal` is left out: it leaves
 * without a remove the wrapper could see. A timeout and a frame count while
 * pending.
 */
export type Handles = {
	listeners: number;
	intervals: number;
	timeouts: number;
	frames: number;
};

export function countHandles(): void {
	let listeners = 0;
	const intervals = new Set<number>();
	const timeouts = new Set<number>();
	const frames = new Set<number>();

	// Per target: its listeners by type and phase, and their count apart, so
	// the count the registry gives back on collection holds no listener that
	// could keep the target alive.
	const kept = new WeakMap<EventTarget, Map<string, Set<unknown>>>();
	const counts = new WeakMap<EventTarget, { n: number }>();
	const collected = new FinalizationRegistry<{ n: number }>(
		(c) => (listeners -= c.n),
	);
	const phase = (o: unknown) =>
		typeof o === 'boolean' ? o : !!(o as { capture?: boolean })?.capture;
	const leaves = (o: unknown) =>
		typeof o === 'object' &&
		!!o &&
		(!!(o as { once?: boolean }).once || !!(o as { signal?: unknown }).signal);

	const T = EventTarget.prototype;
	const add = T.addEventListener;
	const remove = T.removeEventListener;
	T.addEventListener = function (type, fn, opts) {
		add.call(this, type, fn, opts);
		if (!fn || leaves(opts)) return;
		let byKey = kept.get(this);
		let count = counts.get(this);
		if (!byKey || !count) {
			kept.set(this, (byKey = new Map()));
			counts.set(this, (count = { n: 0 }));
			collected.register(this, count);
		}
		const key = `${type}|${phase(opts)}`;
		let set = byKey.get(key);
		if (!set) byKey.set(key, (set = new Set()));
		if (set.has(fn)) return;
		set.add(fn);
		count.n++;
		listeners++;
	};
	T.removeEventListener = function (type, fn, opts) {
		remove.call(this, type, fn, opts);
		const count = counts.get(this);
		if (
			fn &&
			count &&
			kept
				.get(this)
				?.get(`${type}|${phase(opts)}`)
				?.delete(fn)
		) {
			count.n--;
			listeners--;
		}
	};

	const w = window as unknown as Record<string, unknown>;
	const setI = window.setInterval.bind(window);
	const clearI = window.clearInterval.bind(window);
	const setT = window.setTimeout.bind(window);
	const clearT = window.clearTimeout.bind(window);
	const raf = window.requestAnimationFrame.bind(window);
	const caf = window.cancelAnimationFrame.bind(window);
	w.setInterval = (fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
		const id = setI(fn, ms, ...rest);
		intervals.add(id);
		return id;
	};
	w.clearInterval = (id?: number) => {
		if (id !== undefined) intervals.delete(id);
		clearI(id);
	};
	w.setTimeout = (fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
		const id: number = setT(
			typeof fn === 'function'
				? (...a: unknown[]) => {
						timeouts.delete(id);
						fn(...a);
					}
				: fn,
			ms,
			...rest,
		);
		if (typeof fn === 'function') timeouts.add(id);
		return id;
	};
	w.clearTimeout = (id?: number) => {
		if (id !== undefined) timeouts.delete(id);
		clearT(id);
	};
	w.requestAnimationFrame = (fn: FrameRequestCallback) => {
		const id = raf((now) => {
			frames.delete(id);
			fn(now);
		});
		frames.add(id);
		return id;
	};
	w.cancelAnimationFrame = (id: number) => {
		frames.delete(id);
		caf(id);
	};
	w.__handles = (): Handles => ({
		listeners,
		intervals: intervals.size,
		timeouts: timeouts.size,
		frames: frames.size,
	});
}
