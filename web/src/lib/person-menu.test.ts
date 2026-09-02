import { describe, expect, it, vi } from 'vitest';
import { personMenu } from '$lib/person-menu';

describe('personMenu (#486)', () => {
	it('leads with what a click on the object already does', () => {
		expect(personMenu('u1', () => {}).map((item) => item.label)).toEqual([
			'View profile',
			'Message',
		]);
		expect(
			personMenu('u1', () => {}, { conversation: true }).map(
				(item) => item.label,
			),
		).toEqual(['Open the conversation', 'View profile']);
	});

	it('goes where the row already links', () => {
		const go = vi.fn();
		for (const item of personMenu('u1', go)) item.onSelect();
		expect(go.mock.calls).toEqual([['/u/u1'], ['/messages/dm/u1']]);
	});

	it('offers no conversation with yourself', () => {
		const [, mine] = personMenu('me', () => {}, { you: true });
		expect(mine.disabled).toBe(true);
		const [, theirs] = personMenu('them', () => {});
		expect(theirs.disabled).toBeFalsy();
	});
});
