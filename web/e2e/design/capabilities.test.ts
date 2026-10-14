// The shots' capability pin (#3884): a Mac's Chrome has navigator.share and
// may have Web Bluetooth, headless Linux has neither, and the app draws Pair
// and Share from them. The pin must give both the same answer.
import { afterEach, expect, it, vi } from 'vitest';
import { pinCapabilities } from './capabilities';

function fakeBrowser(has: { bluetooth: boolean; share: boolean }) {
	class FakeNavigator {}
	if (has.bluetooth)
		Object.defineProperty(FakeNavigator.prototype, 'bluetooth', {
			get: () => ({ requestDevice: () => Promise.resolve('a real chooser') }),
			configurable: true,
		});
	if (has.share)
		Object.defineProperty(FakeNavigator.prototype, 'share', {
			value: () => Promise.resolve(),
			configurable: true,
		});
	vi.stubGlobal('Navigator', FakeNavigator);
	vi.stubGlobal('navigator', new FakeNavigator());
	return navigator as unknown as Record<string, unknown>;
}

afterEach(() => vi.unstubAllGlobals());

for (const [name, has] of [
	['a Mac with both', { bluetooth: true, share: true }],
	['headless Linux with neither', { bluetooth: false, share: false }],
] as const) {
	it(`${name}: a riding context has the stub and no share`, async () => {
		const nav = fakeBrowser(has);
		pinCapabilities({ bluetooth: true });
		expect(!!nav.bluetooth).toBe(true);
		await expect(
			(nav.bluetooth as BluetoothLike).requestDevice(),
		).rejects.toMatchObject({ name: 'NotFoundError' });
		expect(nav.share).toBeUndefined();
	});

	it(`${name}: a spectator phone has no Bluetooth and no share`, () => {
		const nav = fakeBrowser(has);
		pinCapabilities({ bluetooth: false });
		expect(!!nav.bluetooth).toBe(false);
		expect(nav.share).toBeUndefined();
	});
}

interface BluetoothLike {
	requestDevice(): Promise<unknown>;
}
