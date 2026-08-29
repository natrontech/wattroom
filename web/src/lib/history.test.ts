import { describe, expect, it } from 'vitest';
import { summarise } from './history.svelte';

describe('summarise', () => {
	it('is zeroed for a ride with no samples', () => {
		expect(summarise([])).toEqual({ seconds: 0, kj: 0, avgWatts: 0 });
	});

	it('counts one second per sample and rounds work to whole kJ', () => {
		// 120 samples at 200 W = 24 000 J = 24 kJ.
		expect(summarise(Array(120).fill({ watts: 200 }))).toEqual({
			seconds: 120,
			kj: 24,
			avgWatts: 200,
		});
	});

	it('rounds the average rather than truncating, matching what importers compute', () => {
		expect(summarise([{ watts: 200 }, { watts: 201 }]).avgWatts).toBe(201);
	});
});
