// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const toggleMap = vi.fn(() => true);
const askViewFlip = vi.fn(() => true);
vi.mock('$lib/session/computer-pages', () => ({
	toggleMap: () => toggleMap(),
}));
vi.mock('$lib/world/ride-view', () => ({ askViewFlip: () => askViewFlip() }));

const { bindViewKeys, rideKeyOf } = await import('./keys');

const press = (key: string) => {
	const event = new KeyboardEvent('keydown', { key, cancelable: true });
	window.dispatchEvent(event);
	return event.defaultPrevented;
};

describe('M and V on a session’s and a free ride’s surface (#4236)', () => {
	afterEach(() => vi.clearAllMocks());

	it('reads V as the view flip', () => {
		expect(
			rideKeyOf({
				key: 'v',
				metaKey: false,
				ctrlKey: false,
				altKey: false,
				shiftKey: false,
			}),
		).toEqual({ kind: 'view' });
	});

	it('turns to MAP and back, and flips 3D / Flat', () => {
		const off = bindViewKeys(() => false);
		expect(press('m')).toBe(true);
		expect(press('v')).toBe(true);
		off();
		expect(toggleMap).toHaveBeenCalledOnce();
		expect(askViewFlip).toHaveBeenCalledOnce();
	});

	it('leaves every other key to whoever has it', () => {
		const off = bindViewKeys(() => false);
		for (const key of ['h', 'o', '1', '?']) expect(press(key)).toBe(false);
		off();
	});

	it('yields M to a soundboard pad bound to it', () => {
		const off = bindViewKeys((k) => k === 'm');
		expect(press('m')).toBe(false);
		off();
		expect(toggleMap).not.toHaveBeenCalled();
	});
});

describe('where M and V are bound', () => {
	it('on a session’s surface and a free ride’s, beside the solo ride’s own keys', async () => {
		const { readFileSync } = await import('node:fs');
		const { join } = await import('node:path');
		const { code } = await import('$lib/source-scan.test-helper');
		const src = join(import.meta.dirname, '..');
		for (const file of ['session/Training.svelte', 'ride/FreeRiding.svelte'])
			expect(code(readFileSync(join(src, file), 'utf8'))).toContain(
				'bindViewKeys(',
			);
	});
});
