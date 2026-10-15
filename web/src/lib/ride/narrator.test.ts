import type { MomentEvent } from '$lib/moments';
import { describe, expect, it } from 'vitest';
import {
	createNarrator,
	crewLines,
	momentLine,
	POLITE_GAP_MS,
	stateLine,
	type Narration,
} from './narrator';

function rig() {
	let t = 100_000;
	let last: Narration = { polite: '', alert: '', politeSeq: 0, alertSeq: 0 };
	const n = createNarrator(
		() => t,
		(x) => (last = x),
	);
	return { n, at: (ms: number) => (t += ms), get: () => last };
}

describe('the ride narrator (#3213)', () => {
	it('speaks one polite line per 5 s and keeps only the newest waiting', () => {
		const r = rig();
		r.n.polite('one');
		r.at(1000);
		r.n.polite('two');
		r.at(1000);
		r.n.polite('three');
		r.n.tick();
		expect(r.get().polite).toBe('one');
		r.at(POLITE_GAP_MS);
		r.n.tick();
		expect(r.get().polite).toBe('three');
		r.at(POLITE_GAP_MS);
		r.n.tick();
		expect(r.get().politeSeq).toBe(2);
	});

	it('never holds an alert back', () => {
		const r = rig();
		r.n.polite('one');
		r.n.alert('Sprint armed');
		expect(r.get().alert).toBe('Sprint armed');
		expect(r.get().polite).toBe('one');
	});

	it('words the state for the S key', () => {
		expect(
			stateLine({
				m: 12400,
				lengthM: 51700,
				grade: 5.8,
				toTopM: 6000,
				watts: 258,
				zone: 3,
			}),
		).toBe('km 12.4 of 51.7, 5.8 %, 6.0 km to the top, 258 W, zone 3');
		expect(
			stateLine({ m: 0, lengthM: 1000, grade: -2, watts: 0, zone: 1 }),
		).toBe('km 0.0 of 1.0, -2.0 %, 0 W, zone 1');
	});

	it('says a moment once, as it enters', () => {
		const e: MomentEvent = {
			kind: 'summit',
			payloads: [],
			stage: 'enter',
			confetti: false,
		};
		expect(momentLine(e)).toBe('Summit');
		expect(momentLine({ ...e, stage: 'hold' })).toBeNull();
	});
});

describe('the narrator feeds (#3213)', () => {
	it('names who joined and who left, and says nothing for an unchanged crew', () => {
		const a = new Map([['1', 'Anna']]);
		const b = new Map([
			['1', 'Anna'],
			['2', 'Tom'],
			['3', 'Kim'],
		]);
		expect(crewLines(a, b)).toEqual(['Tom and Kim joined']);
		expect(crewLines(b, a)).toEqual(['Tom and Kim left']);
		expect(crewLines(a, a)).toEqual([]);
	});

	it('does not say the same polite line twice inside the gap', () => {
		const r = rig();
		r.n.polite('Summit');
		r.at(1000);
		r.n.polite('Summit');
		r.at(POLITE_GAP_MS);
		r.n.tick();
		expect(r.get().politeSeq).toBe(1);
	});
});
