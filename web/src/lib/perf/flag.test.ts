import { describe, expect, it } from 'vitest';
import { PERF_KEY, readPerfFlag } from './flag';

function store(initial: Record<string, string> = {}) {
	const m = new Map(Object.entries(initial));
	return {
		m,
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
		removeItem: (k: string) => void m.delete(k),
	};
}

describe('?perf', () => {
	it('is off unless asked', () => {
		expect(readPerfFlag('', store())).toBe(false);
		expect(readPerfFlag('?as=Jan', store())).toBe(false);
	});

	it('turns on and stays on in the tab', () => {
		const s = store();
		expect(readPerfFlag('?perf', s)).toBe(true);
		expect(s.m.get(PERF_KEY)).toBe('1');
		expect(readPerfFlag('', s)).toBe(true);
		expect(readPerfFlag('?road=intro&perf=1', store())).toBe(true);
	});

	it('turns off with ?perf=0', () => {
		const s = store({ [PERF_KEY]: '1' });
		expect(readPerfFlag('?perf=0', s)).toBe(false);
		expect(s.m.has(PERF_KEY)).toBe(false);
		expect(readPerfFlag('', s)).toBe(false);
	});

	it('follows the URL alone where storage refuses', () => {
		const refusing = {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			},
			removeItem: () => {
				throw new Error('denied');
			},
		};
		expect(readPerfFlag('?perf', refusing)).toBe(true);
		expect(readPerfFlag('', refusing)).toBe(false);
		expect(readPerfFlag('?perf', null)).toBe(true);
	});
});
