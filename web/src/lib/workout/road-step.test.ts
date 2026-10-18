import { expect, it } from 'vitest';
import { flatten, targetAt } from './engine';
import { validateWorkout } from './validate';

it('parses repeated road steps as untargeted timeline segments', () => {
	const parsed = validateWorkout(
		JSON.parse(`{"name":"Road steps","steps":[
  {"type":"steady","seconds":5,"target":0.8},
  {"type":"repeat","times":2,"steps":[{"type":"road","seconds":10,"fromM":500}]},
  {"type":"road","seconds":10},
  {"type":"steady","seconds":5,"watts":150}
 ]}`),
	);
	expect(parsed.ok).toBe(true);
	if (!parsed.ok) throw new Error(parsed.error);
	const segments = flatten(parsed.workout);
	expect(segments.map((s) => s.kind)).toEqual([
		'steady',
		'road',
		'road',
		'road',
		'steady',
	]);
	expect(segments[1]).toMatchObject({
		startSeconds: 5,
		seconds: 10,
		fromM: 500,
		stepPath: [1, 0],
	});
	expect(segments[3].fromM).toBeUndefined();
	for (const t of [5, 14, 15, 24, 25, 34]) {
		expect(targetAt(segments, 250, t, { bias: 1.2 }).targetWatts).toBeNull();
	}
	expect(targetAt(segments, 250, 35).targetWatts).toBe(150);
	expect(targetAt(segments, 250, 40).done).toBe(true);
});
