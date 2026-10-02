import { describe, expect, it } from 'vitest';
import { momentOf } from './moment';

const at = (query: string) => momentOf(new URLSearchParams(query));

describe('a moment of /dev/world (#3672)', () => {
	it('reads the metre, the progress, the camera, the look and the chrome', () => {
		expect(at('m=1200&p=1&cam=heli&look=bluehour&chrome=0')).toEqual({
			m: 1200,
			p: 1,
			cam: 'heli',
			look: 'bluehour',
			chrome: false,
		});
	});

	it('starts the ride with the chase camera and the gallery around it, unless told', () => {
		expect(at('m=0')).toEqual({
			m: 0,
			p: 0,
			cam: 'chase',
			look: null,
			chrome: true,
		});
	});

	it('stands off your shoulder for the side view, and chases for any other camera', () => {
		expect(at('m=0&cam=side')?.cam).toBe('side');
		expect(at('m=0&cam=drone')?.cam).toBe('chase');
	});

	it('is no moment without a metre it can stand on', () => {
		for (const q of ['', 'p=1', 'm=-5', 'm=km']) expect(at(q), q).toBeNull();
		expect(at('m=10&p=7')?.p).toBe(1);
	});
});
