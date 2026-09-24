import { describe, expect, it } from 'vitest';
import { people } from './people.svelte';

describe('people.learn — status lines (ADR-0060)', () => {
	const sick = { emoji: '\u{1F912}', text: 'Out sick' };

	it('keeps a line when a feed that does not carry one teaches the face', () => {
		people.learn([{ id: 'ann', name: 'Ann', statusLine: sick }]);
		// The DM heads and a chat line know the name, never the status.
		people.learn([{ id: 'ann', name: 'Ann', avatarUrl: '/a.png' }]);
		expect(people.face('ann')).toMatchObject({
			avatarUrl: '/a.png',
			statusLine: sick,
		});
	});

	it('clears it when a feed that carries it says none', () => {
		people.learn([{ id: 'ben', name: 'Ben', statusLine: sick }]);
		people.learn([{ id: 'ben', name: 'Ben', statusLine: null }]);
		expect(people.face('ben')?.statusLine).toBeNull();
	});

	it('takes a changed line', () => {
		people.learn([{ id: 'cat', name: 'Cat', statusLine: sick }]);
		people.learn([
			{ id: 'cat', name: 'Cat', statusLine: { ...sick, text: 'Better' } },
		]);
		expect(people.face('cat')?.statusLine?.text).toBe('Better');
	});
});
