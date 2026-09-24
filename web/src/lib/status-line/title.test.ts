import { describe, expect, it } from 'vitest';
import { titleWithStatus } from './title';

describe('titleWithStatus', () => {
	const now = Date.parse('2026-09-24T20:00:00Z');

	it('puts the status emoji after the name', () => {
		expect(
			titleWithStatus('Sven', { emoji: '🏔️', text: 'Riding outside' }, now),
		).toBe('Sven 🏔️');
	});

	it('says only the name for no status, words alone, or a crew emoji', () => {
		expect(titleWithStatus('Sven', null, now)).toBe('Sven');
		expect(titleWithStatus('Sven', { text: 'Out sick' }, now)).toBe('Sven');
		expect(
			titleWithStatus('Sven', { emoji: ':watt_dot:', emojiId: 'x' }, now),
		).toBe('Sven');
	});

	it('drops a status that has already cleared', () => {
		const line = { emoji: '🤒', expiresAt: '2026-09-24T19:59:00Z' };
		expect(titleWithStatus('Sven', line, now)).toBe('Sven');
		expect(
			titleWithStatus(
				'Sven',
				{ ...line, expiresAt: '2026-09-24T21:00:00Z' },
				now,
			),
		).toBe('Sven 🤒');
	});
});
