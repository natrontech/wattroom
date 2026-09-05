import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DUCK_DEPTH } from '$lib/sound/ducking';
import {
	MUSIC_FADER,
	RIDER_FADER,
	UNIT_FADER,
	type Fader,
} from '$lib/sound/fader';

// The cue engine opens an AudioContext on first use; the mixer only needs
// its setters to exist.
vi.mock('$lib/sound/cues', () => ({
	setDuckLevel: vi.fn(),
	setVolume: vi.fn(),
}));

// The device, as a Map: the mixer reaches storage only through this module
// (#713), so no platform `localStorage` — happy-dom's, or the one Node now
// ships — can stand in for it and carry state between tests.
const store = { value: null as string | null };
vi.mock('$lib/sound/mixer-storage', () => ({
	mixerStorage: {
		read: () => store.value,
		write: (json: string) => void (store.value = json),
	},
}));

/** The module reads storage once at import — a fresh import is a reload. */
async function freshMixer() {
	vi.resetModules();
	return (await import('./mixer.svelte')).mixer;
}

const stored = () => JSON.parse(store.value ?? '{}');
const seed = (mix: object) => void (store.value = JSON.stringify(mix));

/**
 * Every position a fader can be dragged to, as its range input emits it:
 * rounded to the step's own precision, or 0.01 steps accumulate float dust
 * (0.07 becoming 0.07000000000000001) that no `<input>` ever produces.
 */
function positions({ min, max, step }: Fader): number[] {
	const digits = Math.max(0, -Math.floor(Math.log10(step)));
	const out: number[] = [];
	for (let v = min; v <= max + step / 2; v += step)
		out.push(Number(v.toFixed(digits)));
	return out;
}

describe('mixer defaults', () => {
	beforeEach(() => (store.value = null));

	it('ducks to the SPEC depth, and only to it (#677)', async () => {
		const mixer = await freshMixer();
		expect(mixer.duck).toBe(DUCK_DEPTH);
		expect(DUCK_DEPTH).toBe(0.25);
	});

	it('falls back to the SPEC depth when the stored one is junk', async () => {
		seed({ duck: 'loud' });
		expect((await freshMixer()).duck).toBe(DUCK_DEPTH);
		store.value = '{not json';
		expect((await freshMixer()).duck).toBe(DUCK_DEPTH);
	});
});

describe('mixer rider gain (#463)', () => {
	beforeEach(() => (store.value = null));

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
		seed({
			music: 40,
			riders: { anna: 1, ben: 1.2, junk: 'loud', high: 7 },
		});
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

describe('fader resolution (#509)', () => {
	beforeEach(() => (store.value = null));

	it('gives every fader 1 % of travel — no 5 % notches to settle between', () => {
		expect(positions(MUSIC_FADER)).toHaveLength(101);
		expect(positions(RIDER_FADER)).toHaveLength(201);
		expect(positions(UNIT_FADER)).toHaveLength(101);
	});

	it('keeps every music position the fader can emit', async () => {
		const mixer = await freshMixer();
		for (const v of positions(MUSIC_FADER)) {
			mixer.setMusic(v);
			expect(mixer.music).toBe(v);
		}
	});

	it('keeps every cue and duck position the fader can emit', async () => {
		const mixer = await freshMixer();
		for (const v of positions(UNIT_FADER)) {
			mixer.setCues(v);
			mixer.setDuck(v);
			expect(mixer.cues).toBe(v);
			expect(mixer.duck).toBe(v);
		}
	});

	it('keeps every rider position, and still forgets the one at unity', async () => {
		const mixer = await freshMixer();
		for (const pct of positions(RIDER_FADER)) {
			mixer.setRiderGain('anna', pct / 100, 'Anna');
			// The fader reads back the percent it was dragged to (RiderVolume).
			expect(Math.round(mixer.riderGain('anna') * 100)).toBe(pct);
			expect(mixer.mixedRiders).toHaveLength(pct === 100 ? 0 : 1);
		}
	});

	it('carries a level set between two old notches through a reload', async () => {
		const mixer = await freshMixer();
		mixer.setMusic(43);
		mixer.setCues(0.63);
		mixer.setDuck(0.17);
		mixer.setRiderGain('anna', 1.37, 'Anna');

		const reloaded = await freshMixer();
		expect(reloaded.music).toBe(43);
		expect(reloaded.cues).toBe(0.63);
		expect(reloaded.duck).toBe(0.17);
		expect(reloaded.riderGain('anna')).toBe(1.37);
	});
});
