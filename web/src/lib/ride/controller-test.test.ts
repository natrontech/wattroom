import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/ride/gears-enabled', () => ({ gearsEnabled: () => true }));
const { pressOfController, pressOfKey } = await import('./controller-test');
const { KEY_TABLE } = await import('./keys');

const key = (k: string, code = '') => ({
	key: k,
	code,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
});
const lines = new Set(KEY_TABLE.map(([, does]) => does));

describe('the Controllers page’s pad (#4236)', () => {
	it('names the line of the key table each ride key runs', () => {
		const pressed = [
			'.',
			',',
			'ArrowRight',
			'1',
			'h',
			'm',
			'v',
			'o',
			's',
			'?',
		].map((k) => pressOfKey(key(k)));
		expect(pressed).toEqual([
			'Harder',
			'Easier',
			'Computer page',
			'Camera',
			'Clean view',
			'Map page, and back',
			'3D or Flat',
			'Snapshot',
			'Say the ride',
			'The keys',
		]);
		for (const does of pressed) expect(lines.has(does!)).toBe(true);
	});

	it('names nothing for a key WattRoom does not read', () => {
		expect(pressOfKey(key('x'))).toBeNull();
		expect(pressOfKey({ ...key('m'), metaKey: true })).toBeNull();
	});

	it('names an OpenBikeControl press the same way', () => {
		expect(pressOfController('harder')).toBe('Harder');
		expect(pressOfController('page-prev')).toBe('Computer page');
		expect(pressOfController('map')).toBe('Map page, and back');
	});
});
