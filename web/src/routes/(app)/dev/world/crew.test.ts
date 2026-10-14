import { describe, expect, it } from 'vitest';
import { devCrew } from './crew';

describe('the dev gallery crew', () => {
	it('rides with stand-ins by default', () => {
		expect(devCrew(200, 250).map((r) => r.name)).toContain('Mia');
	});

	it('is you alone for a design capture', () => {
		expect(devCrew(200, 250, null, true).map((r) => r.id)).toEqual(['you']);
	});
});
