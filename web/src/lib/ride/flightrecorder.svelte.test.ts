// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlightRecorder, describeReason } from './flightrecorder.svelte';

/** Fires the DOM event the browser raises for a promise nobody caught. */
function reject(reason: unknown) {
	const event = new Event('unhandledrejection') as Event & { reason: unknown };
	event.reason = reason;
	window.dispatchEvent(event);
}

describe('flight recorder', () => {
	afterEach(() => vi.restoreAllMocks());

	it('keeps power, cadence, target and state — never heart rate (#636)', () => {
		const recorder = createFlightRecorder();
		const sample = { second: 41, watts: 210, cadence: 88, heartRate: 151 };
		recorder.tick({ ...sample, target: 200, state: 'riding' });
		recorder.flag();
		const [tick] = recorder.flags[0].snapshot.ticks;
		expect(tick).toEqual({
			at: expect.any(Number),
			watts: 210,
			cadence: 88,
			target: 200,
			state: 'riding',
		});
		expect(JSON.stringify(recorder.flags[0].snapshot)).not.toContain('151');
	});

	it('captures unhandled promise rejections beside errors (#668)', () => {
		const recorder = createFlightRecorder();
		reject(new TypeError('fetch failed'));
		reject('plain string');
		reject(undefined);
		recorder.flag();
		const texts = recorder.flags[0].snapshot.errors.map((e) => e.text);
		expect(
			texts.some((t) =>
				t.startsWith('unhandled rejection: TypeError: fetch failed'),
			),
		).toBe(true);
		expect(texts).toContain('unhandled rejection: plain string');
		expect(texts).toContain('unhandled rejection: undefined');
	});

	it('bounds every error entry', () => {
		const recorder = createFlightRecorder();
		reject('x'.repeat(2000));
		recorder.flag();
		const last = recorder.flags[0].snapshot.errors.at(-1)!;
		expect(last.text.length).toBeLessThanOrEqual(500);
	});
});

describe('describeReason', () => {
	it('never throws, whatever was rejected with', () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(describeReason(circular)).toBe('[object Object]');
		expect(describeReason({ code: 'E_NOPE' })).toBe('{"code":"E_NOPE"}');
		expect(describeReason(null)).toBe('null');
		expect(describeReason(Symbol('s'))).toBe('Symbol(s)');
		expect(describeReason(new RangeError('too far'))).toMatch(
			/^RangeError: too far/,
		);
	});
});
