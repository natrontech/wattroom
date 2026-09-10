// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/sound/cues', () => ({ play: () => {} }));
const { toasts } = await import('./toast.svelte');

describe('toasts (#1961)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		for (const t of [...toasts.items]) toasts.dismiss(t.id);
		vi.useRealTimers();
	});

	it('takes a plain toast down after its time, and an undo toast never on its own', () => {
		toasts.push('saved');
		toasts.push('removed', { undo: () => {} });
		vi.advanceTimersByTime(4_100);
		expect(toasts.items.map((t) => t.text)).toEqual(['removed']);
		vi.advanceTimersByTime(60_000);
		expect(toasts.items.map((t) => t.text)).toEqual(['removed']);
	});

	it('lets the next undo toast take the previous one down', () => {
		toasts.push('one', { undo: () => {} });
		toasts.push('two', { undo: () => {} });
		expect(toasts.items.map((t) => t.text)).toEqual(['two']);
	});

	it('holds the clock while the pointer or focus is on the stack', () => {
		toasts.push('saved');
		vi.advanceTimersByTime(3_000);
		toasts.hold();
		vi.advanceTimersByTime(10_000);
		expect(toasts.items).toHaveLength(1);
		toasts.release();
		vi.advanceTimersByTime(1_100);
		expect(toasts.items).toHaveLength(0);
	});
});
