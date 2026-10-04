import { afterEach, describe, expect, it, vi } from 'vitest';
import { softwareDrawing } from './flag';

const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => stored.get(k) ?? null,
	setItem: (k: string, v: string) => stored.set(k, v),
});

describe('softwareDrawing', () => {
	afterEach(() => stored.clear());

	it('is off until a dev capture sets it', () => {
		expect(softwareDrawing()).toBe(false);
		localStorage.setItem('wattroom.world-software.v1', '1');
		expect(softwareDrawing()).toBe(true);
	});
});
