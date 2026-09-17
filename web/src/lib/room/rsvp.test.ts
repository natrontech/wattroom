import { describe, expect, it } from 'vitest';
import { rsvpSummary } from './rsvp';

describe('rsvpSummary', () => {
	it('names the three states as counts', () => {
		expect(rsvpSummary({ in: 4, out: 2, unanswered: 9 })).toBe(
			'4 in · 2 out · 9 unanswered',
		);
	});

	it('leaves out the parts that are nobody', () => {
		expect(rsvpSummary({ in: 4, out: 0, unanswered: 9 })).toBe(
			'4 in · 9 unanswered',
		);
		expect(rsvpSummary({ in: 0, out: 2, unanswered: 0 })).toBe('2 out');
		expect(rsvpSummary({ in: 0, out: 2, unanswered: 7 })).toBe(
			'2 out · 7 unanswered',
		);
		expect(rsvpSummary({ in: 3, out: 0, unanswered: 0 })).toBe('3 in');
	});

	it('teaches rather than counts while nobody has answered', () => {
		// The case a plan actually opens in: a room of nine, nothing said. A
		// bare "9 unanswered" is true and tells the planner nothing they can
		// act on, and says nothing about the two buttons beside it.
		expect(rsvpSummary({ in: 0, out: 0, unanswered: 9 })).toBe(
			'nobody has answered yet',
		);
		expect(rsvpSummary({ in: 0, out: 0, unanswered: 0 })).toBe(
			'nobody has answered yet',
		);
	});

	it('binds the names to the in count and to nothing else', () => {
		expect(rsvpSummary({ in: 2, out: 2, unanswered: 1 }, 'Ada, Kim')).toBe(
			'2 in — Ada, Kim · 2 out · 1 unanswered',
		);
		// Nobody is in, so there is nobody to name and nothing to bind a name
		// to — the "out" count must not inherit the list.
		expect(rsvpSummary({ in: 0, out: 2, unanswered: 1 }, 'Ada, Kim')).toBe(
			'2 out · 1 unanswered',
		);
	});

	// The decision this implements (#1011): a count is the whole of what a
	// decline shows. Structural, not a spot check — whatever the numbers,
	// the line is digits and the three glossary words, so there is no shape
	// of input that puts a rider in it.
	it('says how many are out and nothing else about them', () => {
		const line = rsvpSummary({ in: 1, out: 7, unanswered: 2 });
		expect(line).toContain('7 out');
		expect(
			line.replace(/\d+ (in|out|unanswered)/g, '').replace(/ · /g, ''),
		).toBe('');
	});
});
