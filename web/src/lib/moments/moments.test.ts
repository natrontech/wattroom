import { describe, expect, it } from 'vitest';
import { DUR, HOLD_ANNOUNCE } from '$lib/motion/tokens';
import {
	confetti,
	createMoments,
	DEFER_MS,
	MERGE_MS,
	TICKER_LINES,
	type Moment,
	type MomentsDeps,
} from '.';

/** A queue on a clock the test owns. */
function rig(extra: Partial<MomentsDeps> = {}) {
	let t = 0;
	const moments = createMoments<string>({ now: () => t, ...extra });
	const at = (ms: number) => {
		t = ms;
		return moments
			.tick()
			.map((e) => `${e.stage} ${e.kind} ${e.payloads.join('+')}`);
	};
	return { moments, at, now: () => t, set: (ms: number) => (t = ms) };
}

const pr = (payload: string): Moment<string> => ({ kind: 'pr', payload });
const finish = (payload: string): Moment<string> => ({
	kind: 'finish',
	payload,
});
const HOLD_ENDS = DUR.stage + HOLD_ANNOUNCE;

describe('the moments queue (#3210)', () => {
	it('shows one moment through enter, hold and exit', () => {
		const q = rig();
		q.moments.stage(pr('5 s'));
		expect(q.at(0)).toEqual(['enter pr 5 s']);
		expect(q.at(DUR.stage)).toEqual(['hold pr 5 s']);
		expect(q.at(HOLD_ENDS)).toEqual(['exit pr 5 s']);
		expect(q.at(HOLD_ENDS + DUR.quick)).toEqual([]);
	});

	it('lets a finish cut a PR short, and the PR is gone', () => {
		const q = rig();
		q.moments.stage(pr('5 s'));
		q.at(0);
		q.set(500);
		q.moments.stage(finish('done'));
		expect(q.at(500)).toEqual(['exit pr 5 s']);
		expect(q.at(500 + DUR.quick)).toEqual(['enter finish done']);
		expect(q.at(10_000)).not.toContain('enter pr 5 s');
	});

	it('makes a lower moment wait out a higher one', () => {
		const q = rig();
		q.moments.stage(finish('done'));
		q.at(0);
		q.set(100);
		q.moments.stage(pr('5 s'));
		expect(q.at(100)).toEqual([]);
		expect(q.at(HOLD_ENDS)).toEqual(['hold finish done', 'exit finish done']);
		expect(q.at(HOLD_ENDS + DUR.quick)).toEqual(['enter pr 5 s']);
	});

	it('merges same-kind moments inside 1.5 s, even onto the one showing', () => {
		const q = rig();
		q.moments.stage(pr('5 s'));
		q.moments.stage(pr('1 min'));
		expect(q.at(0)).toEqual(['enter pr 5 s+1 min']);
		// Onto the one on stage: it holds again, whole, with the newcomer in it.
		q.set(MERGE_MS);
		q.moments.stage(pr('20 min'));
		expect(q.at(MERGE_MS)).toEqual(['hold pr 5 s+1 min+20 min']);
		// Past the window it waits its turn as a moment of its own.
		q.set(MERGE_MS * 2 + 1);
		q.moments.stage(pr('FTP'));
		expect(q.at(MERGE_MS * 2 + 1)).toEqual([]);
		const end = MERGE_MS + HOLD_ANNOUNCE + DUR.quick;
		expect(q.at(end)).toEqual(['exit pr 5 s+1 min+20 min', 'enter pr FTP']);
	});

	it('defers a moment that would land just before an interval change', () => {
		const change = 10_000;
		const q = rig({ nextInterval: () => change });
		q.set(change - DEFER_MS + 1);
		q.moments.stage(pr('5 s'));
		expect(q.at(change - DEFER_MS + 1)).toEqual([]);
		expect(q.at(change - 1)).toEqual([]);
		expect(q.at(change)).toEqual(['enter pr 5 s']);
	});

	it('never lands inside another rider’s sprint window', () => {
		const q = rig({ sprintWindowEnd: () => 15_000 });
		q.moments.stage(pr('5 s'));
		expect(q.at(0)).toEqual([]);
		expect(q.at(15_000)).toEqual(['enter pr 5 s']);
	});

	it('catches up in one tick after a long gap, a hidden tab’s', () => {
		const q = rig();
		q.moments.stage(pr('5 s'));
		expect(q.at(0)).toEqual(['enter pr 5 s']);
		expect(q.at(HOLD_ENDS + DUR.quick)).toEqual(['hold pr 5 s', 'exit pr 5 s']);
		q.moments.stage(pr('1 min'));
		expect(q.at(HOLD_ENDS + DUR.quick + 1)).toEqual(['enter pr 1 min']);
	});
});

describe('the ticker lane', () => {
	it('holds two lines, oldest out, repeats merged per verb', () => {
		const q = rig();
		q.moments.ticker('Anna', 'rang the bell');
		q.moments.ticker('Anna', 'rang the bell');
		q.moments.ticker('Ben', 'handed up a bottle');
		q.moments.ticker('Anna', 'rang the bell');
		expect(q.moments.tickerLines()).toEqual([
			{ who: 'Anna', verb: 'rang the bell', count: 3 },
			{ who: 'Ben', verb: 'handed up a bottle', count: 1 },
		]);
		q.moments.ticker('Cleo', 'rang the bell');
		expect(q.moments.tickerLines()).toHaveLength(TICKER_LINES);
		expect(q.moments.tickerLines().map((l) => l.who)).toEqual(['Ben', 'Cleo']);
	});

	it('lets a line go after the announce hold', () => {
		const q = rig();
		q.moments.ticker('Anna', 'rang the bell');
		q.at(HOLD_ANNOUNCE);
		expect(q.moments.tickerLines()).toEqual([]);
	});
});

describe('the confetti budget', () => {
	it('is a finish, an HC or category I summit and a race win, only', () => {
		const summit = (category: '1' | '2' | 'HC') =>
			confetti({ kind: 'summit', category, payload: '' });
		const result = (of: 'race' | 'sprint' | 'prime', won: boolean) =>
			confetti({ kind: 'result', of, won, payload: '' });
		expect(confetti(finish(''))).toBe(true);
		expect([summit('HC'), summit('1'), summit('2')]).toEqual([
			true,
			true,
			false,
		]);
		expect([
			result('race', true),
			result('race', false),
			result('sprint', true),
			result('prime', true),
		]).toEqual([true, false, false, false]);
		expect(confetti(pr(''))).toBe(false);
	});
});

describe('a consumer with no world', () => {
	it('narrates the whole queue from a plain loop', () => {
		// What the Skyline or the ride narrator does: tick on its own clock and
		// say what it is handed — no canvas, no frame, no world at all.
		let t = 0;
		const moments = createMoments<string>({ now: () => t });
		const said: string[] = [];
		moments.stage({ kind: 'summit', category: 'HC', payload: 'Stelvio' });
		moments.stage(pr('20 min'));
		for (; t <= 2 * (HOLD_ENDS + DUR.quick); t += 100)
			for (const e of moments.tick())
				if (e.stage === 'enter')
					said.push(`${e.payloads[0]}${e.confetti ? ' 🎉' : ''}`);
		expect(said).toEqual(['Stelvio 🎉', '20 min']);
	});
});
