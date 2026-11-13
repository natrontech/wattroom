import { describe, expect, it } from 'vitest';
import { controlsFor } from './controls';

const running = { phase: 'running', id: 's1' };
const picked = { phase: 'idle', id: 's1' };
const done = { phase: 'done', id: 's1' };
const none = { phase: 'idle' };

describe('controlsFor (#2598)', () => {
	it.each([
		// who, state, canControl, canManage, spectator → view
		['the coach, riding', running, true, false, false, 'coach'],
		['anyone, nothing open', none, true, false, false, 'coach'],
		['anyone, the last one done', done, true, false, false, 'coach'],
		['an admin, someone else coaching', running, false, true, false, 'end'],
		['an admin, someone else’s pick', picked, false, true, false, 'clear'],
		[
			'an admin on a phone, someone else coaching',
			running,
			false,
			true,
			true,
			'end',
		],
		['an admin coaching from a phone', running, true, true, true, 'end'],
		['a member, someone else coaching', running, false, false, false, 'none'],
		['a member, someone else’s pick', picked, false, false, false, 'held'],
		['a member on a phone, nothing open', none, true, false, true, 'none'],
		['an admin, nothing open, on a phone', done, true, true, true, 'none'],
	] as const)('%s → %s', (_, state, canControl, canManage, spectator, want) => {
		expect(controlsFor({ state, canControl, canManage, spectator })).toBe(want);
	});
});

// Whoever planned it may cancel it until it runs (#4562), whoever pressed
// Start; once it runs it is the coach's.
describe('the planner', () => {
	const plan = (phase: string) => ({ id: 's1', phase, planner: 'bob' });
	it.each([
		['their plan, picked', plan('idle'), 'bob', 'clear'],
		['their plan, counting in', plan('countdown'), 'bob', 'clear'],
		['their plan, running', plan('running'), 'bob', 'none'],
		['someone else’s plan, picked', plan('idle'), 'dan', 'held'],
	] as const)('%s → %s', (_, state, me, want) => {
		expect(
			controlsFor({
				state,
				me,
				canControl: false,
				canManage: false,
				spectator: false,
			}),
		).toBe(want);
	});
});
