import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	STARTING_GAIN_MAX,
	STARTING_GAIN_MS,
	createStartingGain,
	startingGain,
} from './starting-gain';

const KEY = 'wattroom.voice.settled.v1';
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
});

function settle(levels: Record<string, number>) {
	store.set(KEY, JSON.stringify(levels));
}

const MARK = 0.02; // the gate's SPEC default
const POST = 20; // the meter's post interval

/** Feed `ms` of a steady level at the meter's rate; returns the last lift. */
function speak(
	lift: ReturnType<typeof createStartingGain>,
	raw: number,
	from: number,
	ms: number,
) {
	let gain = 1;
	for (let t = from; t < from + ms; t += POST) {
		gain = lift.step(raw * gain, gain, MARK, t + POST);
	}
	return gain;
}

describe('startingGain', () => {
	it.each([
		['no settled call yet', null, 0.15, 0, 1],
		['a quiet start, lifted to where it settled', 0.3, 0.2, 0, 1.5],
		['never past the ceiling', 0.3, 0.05, 0, STARTING_GAIN_MAX],
		['never below 1×', 0.3, 0.45, 0, 1],
		['the minute is over', 0.3, 0.15, STARTING_GAIN_MS, 1],
		['no speech heard yet', 0.3, 0, 0, 1],
	])('%s', (_, settled, speech, since, want) => {
		expect(startingGain(settled, speech, since)).toBeCloseTo(want);
	});
});

describe('the starting gain over a call', () => {
	beforeEach(() => store.clear());

	it('lifts a quiet start toward the level the last call settled at', () => {
		settle({ '': 0.3 });
		const lift = createStartingGain(0, '');
		// AGC hands over 0.17 on a quiet mic: the call should hear ~0.3.
		const gain = speak(lift, 0.17, 0, 3_000);
		expect(0.17 * gain).toBeCloseTo(0.3, 2);
	});

	it('lets go once AGC has caught up', () => {
		settle({ '': 0.3 });
		const lift = createStartingGain(0, '');
		speak(lift, 0.17, 0, 3_000);
		expect(speak(lift, 0.3, 3_000, 10_000)).toBeCloseTo(1, 2);
	});

	it('holds still through pauses and the fan', () => {
		settle({ '': 0.3 });
		const lift = createStartingGain(0, '');
		const talking = speak(lift, 0.17, 0, 3_000);
		expect(speak(lift, 0.005, 3_000, 5_000)).toBeCloseTo(talking);
	});

	it('takes a fan the lift pushed over the mark for the fan', () => {
		settle({ '': 0.3 });
		const lift = createStartingGain(0, '');
		const talking = speak(lift, 0.17, 0, 3_000);
		// 0.015 lifted ~1.76× reads 0.026 at the meter, over the mark.
		expect(speak(lift, 0.015, 3_000, 5_000)).toBeCloseTo(talking);
	});

	it('lifts each mic toward its own settled level', () => {
		settle({ headset: 0.4 });
		const lift = createStartingGain(0, 'laptop');
		expect(speak(lift, 0.17, 0, 3_000)).toBe(1);
	});

	it('remembers where a long call settled, per mic', () => {
		settle({ headset: 0.4 });
		const lift = createStartingGain(0, 'laptop');
		speak(lift, 0.17, 0, STARTING_GAIN_MS);
		speak(lift, 0.32, STARTING_GAIN_MS, 20_000);
		lift.close();
		const saved = JSON.parse(store.get(KEY)!);
		expect(saved.laptop).toBeCloseTo(0.32, 2);
		expect(saved.headset).toBe(0.4);
	});

	it('remembers nothing from a call too short to have settled', () => {
		const lift = createStartingGain(0, '');
		speak(lift, 0.17, 0, STARTING_GAIN_MS + 5_000);
		lift.close();
		expect(store.has(KEY)).toBe(false);
	});

	it('ignores a stored level that cannot be one', () => {
		settle({ '': 7 });
		const lift = createStartingGain(0, '');
		expect(speak(lift, 0.17, 0, 3_000)).toBe(1);
	});
});
