import { describe, expect, it } from 'vitest';
import { eventText } from './timeline';
import { screenShareChanges, screenShareEvent } from './screen-shares';

describe('screenShareChanges (#664)', () => {
	it('names who started and who stopped', () => {
		expect(
			screenShareChanges(new Set(['ada']), new Set(['kim']), 'me'),
		).toEqual([
			{ rider: 'kim', live: true },
			{ rider: 'ada', live: false },
		]);
	});

	it('says nothing when nothing changed', () => {
		expect(
			screenShareChanges(new Set(['ada']), new Set(['ada']), 'me'),
		).toEqual([]);
	});

	it('leaves your own share to the notice above the page', () => {
		expect(screenShareChanges(new Set(), new Set(['me']), 'me')).toEqual([]);
		expect(screenShareChanges(new Set(['me']), new Set(), 'me')).toEqual([]);
	});
});

describe('screenShareEvent (#664)', () => {
	it('builds a room-event line the timeline already knows how to word', () => {
		const started = screenShareEvent({ rider: 'kim', live: true }, 'Kim', 5000);
		expect(started).toMatchObject({ kind: 'screen', actor: 'Kim', at: 5000 });
		expect(eventText(started)).toBe('Kim started sharing a screen');
		expect(
			eventText(screenShareEvent({ rider: 'kim', live: false }, 'Kim', 9000)),
		).toBe('Kim stopped sharing');
	});

	it('gives each moment its own line, never replacing the last one', () => {
		const first = screenShareEvent({ rider: 'kim', live: true }, 'Kim', 1000);
		const again = screenShareEvent({ rider: 'kim', live: true }, 'Kim', 2000);
		expect(first.id).not.toBe(again.id);
	});

	it('still has a subject when the roster has not named the rider yet', () => {
		expect(
			eventText(screenShareEvent({ rider: 'x', live: true }, undefined, 1)),
		).toBe('Someone started sharing a screen');
	});
});
