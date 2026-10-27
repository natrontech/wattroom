import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEAD_MS, watchMicHealth } from './mic-health';

/** An event target with a settable state, standing in for a track or a graph. */
function target<T extends object>(fields: T) {
	const listeners = new Map<string, Set<() => void>>();
	const on = (type: string) =>
		listeners.get(type) ?? listeners.set(type, new Set()).get(type)!;
	return Object.assign(fields, {
		addEventListener: (type: string, fn: () => void) => on(type).add(fn),
		removeEventListener: (type: string, fn: () => void) => on(type).delete(fn),
		fire: (type: string) => [...on(type)].forEach((fn) => fn()),
	});
}

const capture = () => target({ muted: false });
const graph = () => target({ state: 'running', resume: vi.fn(async () => {}) });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('an open mic that stopped sending (#4220)', () => {
	it('is dead once its capture stays muted for DEAD_MS', () => {
		const track = capture();
		const dead = vi.fn();
		watchMicHealth({ capture: track, ctx: graph() }, dead);
		track.muted = true;
		track.fire('mute');
		vi.advanceTimersByTime(DEAD_MS - 1);
		expect(dead).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(dead).toHaveBeenCalledOnce();
	});

	it('is alive again when the frames come back in time', () => {
		const track = capture();
		const dead = vi.fn();
		watchMicHealth({ capture: track, ctx: graph() }, dead);
		track.muted = true;
		track.fire('mute');
		vi.advanceTimersByTime(DEAD_MS / 2);
		track.muted = false;
		track.fire('unmute');
		vi.advanceTimersByTime(DEAD_MS * 2);
		expect(dead).not.toHaveBeenCalled();
	});

	it('asks a stopped graph to run, and is dead when it will not', () => {
		const ctx = graph();
		const dead = vi.fn();
		watchMicHealth({ capture: capture(), ctx }, dead, () => true);
		ctx.state = 'suspended';
		ctx.fire('statechange');
		expect(ctx.resume).toHaveBeenCalled();
		vi.advanceTimersByTime(DEAD_MS);
		expect(dead).toHaveBeenCalledOnce();
	});

	it('leaves a hidden tab’s graph to the browser (#214)', () => {
		const ctx = graph();
		const dead = vi.fn();
		watchMicHealth({ capture: capture(), ctx }, dead, () => false);
		ctx.state = 'suspended';
		ctx.fire('statechange');
		vi.advanceTimersByTime(DEAD_MS * 2);
		expect(dead).not.toHaveBeenCalled();
	});

	it('says nothing once stopped', () => {
		const track = capture();
		const dead = vi.fn();
		const stop = watchMicHealth({ capture: track, ctx: null }, dead);
		track.muted = true;
		track.fire('mute');
		stop();
		vi.advanceTimersByTime(DEAD_MS * 2);
		expect(dead).not.toHaveBeenCalled();
	});
});
