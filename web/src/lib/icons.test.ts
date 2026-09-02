import { describe, expect, it } from 'vitest';
import {
	CHEER_ICONS,
	EMOJI_TO_KEY,
	iconFor,
	keyFor,
	ROOM_ICONS,
	STOCK_CHEERS,
} from './icons';

describe('icon keys (#447)', () => {
	it('resolves a key from either vocabulary', () => {
		expect(iconFor('bike')).toBe(ROOM_ICONS.bike);
		expect(iconFor('biceps-flexed')).toBe(CHEER_ICONS['biceps-flexed']);
	});

	it('draws what rooms and clients from before #447 stored', () => {
		expect(keyFor('🔥')).toBe('flame');
		expect(iconFor('🔥')).toBe(CHEER_ICONS.flame);
		// The variation selector a keyboard adds to some emoji is not a
		// different emoji.
		expect(keyFor('❤️')).toBe('heart');
		expect(keyFor('🏔️')).toBe('mountain');
	});

	it('draws nothing for no icon and a placeholder for an unknown one', () => {
		expect(iconFor('')).toBeNull();
		expect(iconFor(undefined)).toBeNull();
		expect(iconFor('🌵')).not.toBeNull();
		expect(keyFor('🌵')).toBe('🌵');
	});

	it('maps every translated emoji to a key that exists', () => {
		for (const key of Object.values(EMOJI_TO_KEY)) {
			expect(ROOM_ICONS[key] ?? CHEER_ICONS[key], key).toBeDefined();
		}
	});

	it('stocks the palette from the cheer vocabulary', () => {
		for (const key of STOCK_CHEERS) {
			expect(CHEER_ICONS[key], key).toBeDefined();
		}
	});
});
