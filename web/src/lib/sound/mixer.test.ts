// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The cue engine opens an AudioContext on first use; the mixer only needs
// its setters to exist.
vi.mock('$lib/sound/cues', () => ({
	setDuckLevel: vi.fn(),
	setVolume: vi.fn(),
}));

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k),
	clear: () => store.clear(),
});

const KEY = 'wattroom.mixer.v1';

/** The module reads localStorage once at import — a fresh import is a reload. */
async function freshMixer() {
	vi.resetModules();
	return (await import('./mixer.svelte')).mixer;
}

const stored = () => JSON.parse(store.get(KEY) ?? '{}');

describe('mixer rider gain (#463)', () => {
	beforeEach(() => store.clear());

	it('is unity for anyone never adjusted, and lists nobody', async () => {
		const mixer = await freshMixer();
		expect(mixer.riderGain('anna')).toBe(1);
		expect(mixer.mixedRiders).toEqual([]);
	});

	it('remembers a fader with the name it was set under', async () => {
		const mixer = await freshMixer();
		mixer.setRiderGain('anna', 1.5, 'Anna');
		expect(mixer.riderGain('anna')).toBe(1.5);
		expect(mixer.mixedRiders).toEqual([
			{ id: 'anna', name: 'Anna', gain: 1.5 },
		]);
	});

	it('clamps to 0–2, the range the WebAudio stage is limited for', async () => {
		const mixer = await freshMixer();
		mixer.setRiderGain('loud', 9, 'Loud');
		mixer.setRiderGain('quiet', -1, 'Quiet');
		expect(mixer.riderGain('loud')).toBe(2);
		expect(mixer.riderGain('quiet')).toBe(0);
	});

	it('persists per device and comes back after a reload', async () => {
		const mixer = await freshMixer();
		mixer.setRiderGain('anna', 0.5, 'Anna');
		expect(stored().riders).toEqual({ anna: 0.5 });
		expect(stored().names).toEqual({ anna: 'Anna' });

		const reloaded = await freshMixer();
		expect(reloaded.riderGain('anna')).toBe(0.5);
		expect(reloaded.mixedRiders).toEqual([
			{ id: 'anna', name: 'Anna', gain: 0.5 },
		]);
	});

	it('forgets a rider set back to 100 % — unity is the default, not a mix', async () => {
		const mixer = await freshMixer();
		mixer.setRiderGain('anna', 1.5, 'Anna');
		mixer.setRiderGain('anna', 1);
		expect(mixer.riderGain('anna')).toBe(1);
		expect(mixer.mixedRiders).toEqual([]);
		expect(stored().riders).toEqual({});
		expect(stored().names).toEqual({});
	});

	it('keeps the name when only the level changes', async () => {
		const mixer = await freshMixer();
		mixer.setRiderGain('anna', 1.5, 'Anna');
		mixer.setRiderGain('anna', 0.8);
		expect(mixer.mixedRiders).toEqual([
			{ id: 'anna', name: 'Anna', gain: 0.8 },
		]);
	});

	it('drops leftover unity entries and junk from an older store', async () => {
		store.set(
			KEY,
			JSON.stringify({
				music: 40,
				riders: { anna: 1, ben: 1.2, junk: 'loud', high: 7 },
			}),
		);
		const mixer = await freshMixer();
		expect(mixer.music).toBe(40);
		expect(mixer.riderGain('anna')).toBe(1);
		expect(mixer.riderGain('junk')).toBe(1);
		expect(mixer.riderGain('high')).toBe(1);
		expect(mixer.mixedRiders).toEqual([
			{ id: 'ben', name: 'a rider who has left', gain: 1.2 },
		]);
	});
});
