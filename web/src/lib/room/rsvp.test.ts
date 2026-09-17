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
		expect(rsvpSummary({ in: 3, out: 0, unanswered: 0 })).toBe('3 in');
	});

	it('teaches rather than apologises when nobody has answered', () => {
		expect(rsvpSummary({ in: 0, out: 0, unanswered: 0 })).toBe(
			'nobody has answered yet',
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
