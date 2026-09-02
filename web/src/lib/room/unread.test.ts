import { describe, expect, it } from 'vitest';
import { missedSince } from './unread';
import type { ChatLine } from '$lib/protocol';

const line = (at: number, fromId: string, text = `at ${at}`): ChatLine => ({
	from: fromId === 'me' ? 'Me' : 'Ruben',
	fromId,
	text,
	at,
});

describe('missedSince', () => {
	it('counts what arrived after you last looked, and quotes the last of it', () => {
		const missed = missedSince(
			[line(1, 'ruben'), line(2, 'ruben'), line(3, 'ruben', 'queue this one')],
			1,
			'me',
		);
		expect(missed).toEqual({
			count: 2,
			from: 'Ruben',
			preview: 'queue this one',
		});
	});

	it('is nothing when the room has been quiet since', () => {
		expect(missedSince([line(1, 'ruben')], 1, 'me')).toBeNull();
		expect(missedSince([], 0, 'me')).toBeNull();
	});

	// Your own line is not something you missed — the bar would announce you
	// to yourself the moment you sent it.
	it('ignores your own lines', () => {
		expect(missedSince([line(5, 'me')], 1, 'me')).toBeNull();
		expect(missedSince([line(5, 'me'), line(6, 'ruben')], 1, 'me')?.count).toBe(
			1,
		);
	});

	// A line with no text and an image still counts as something said.
	it('says what an image-only line is', () => {
		const image: ChatLine = {
			from: 'Ruben',
			fromId: 'ruben',
			text: '',
			imageId: 'i1',
			at: 9,
		};
		expect(missedSince([image], 1, 'me')?.preview).toBe('sent an image');
	});
});
