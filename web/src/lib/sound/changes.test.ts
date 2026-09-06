import { describe, expect, it } from 'vitest';
import { changes } from '$lib/sound/changes';

describe('changes', () => {
	it('stays silent on the first value — arriving is not an event', () => {
		const heard: string[] = [];
		const watch = changes<string>((next) => heard.push(next));
		watch('room');
		expect(heard).toEqual([]);
	});

	it('fires once per move, not once per observation', () => {
		const heard: (string | null)[] = [];
		const watch = changes<string | null>((next) => heard.push(next));
		watch(null);
		watch(null);
		watch('trainer');
		watch('trainer');
		watch('trainer');
		watch(null);
		expect(heard).toEqual(['trainer', null]);
	});

	it('hands the cue what it moved away from', () => {
		const moves: string[] = [];
		const watch = changes<boolean>((next, previous) =>
			moves.push(`${previous}→${next}`),
		);
		watch(false);
		watch(true);
		watch(false);
		expect(moves).toEqual(['false→true', 'true→false']);
	});
});
