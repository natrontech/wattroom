// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GATE_CEIL, GATE_DEFAULT } from '$lib/room/gate-scale';

// The project's localStorage stand-in (same shape as pane.test.ts).
const store = new Map<string, string>();
function workingStorage() {
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear(),
	});
}
workingStorage();

// The one dependency, and the reason #478 is subtle: a rider with music at
// zero hears no bleed, so their gate must not move.
let music = $state(100);
vi.mock('$lib/sound/mixer.svelte', () => ({
	mixer: {
		get music() {
			return music;
		},
	},
}));

const { createGateSettings } = await import('$lib/room/gate-settings.svelte');

describe('gate settings', () => {
	beforeEach(() => {
		store.clear();
		// Re-armed every test: one of them replaces this with a stub that
		// throws, and it must not leak into everything declared after it.
		workingStorage();
		music = 100;
	});

	it('starts on the SPEC defaults', () => {
		const g = createGateSettings();
		expect(g.mode).toBe('gate');
		expect(g.threshold).toBe(GATE_DEFAULT);
		expect(g.pttHeld).toBe(false);
	});

	it('remembers the mode and threshold across a rejoin', () => {
		const first = createGateSettings();
		first.setMode('ptt');
		first.setThreshold(0.05);

		const second = createGateSettings();
		expect(second.mode).toBe('ptt');
		expect(second.threshold).toBeCloseTo(0.05);
	});

	it('clamps a stored threshold to the axis rather than trusting it', () => {
		store.set(
			'wattroom.voice.v1',
			JSON.stringify({ mode: 'gate', threshold: 99 }),
		);
		expect(createGateSettings().threshold).toBe(GATE_CEIL);
	});

	it('survives storage being blocked', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
		});
		const g = createGateSettings();
		expect(g.threshold).toBe(GATE_DEFAULT);
		// And a write that throws must not take the setter down with it.
		expect(() => g.setThreshold(0.03)).not.toThrow();
	});

	describe('the music doubling (#478)', () => {
		it('doubles while the deck plays', () => {
			const g = createGateSettings();
			g.setThreshold(0.02);
			expect(g.effective).toBeCloseTo(0.02);
			g.setDeckPlaying(true);
			expect(g.effective).toBeCloseTo(0.04);
		});

		it('leaves a rider with music at zero alone — no bleed to gate out', () => {
			const g = createGateSettings();
			g.setThreshold(0.02);
			g.setDeckPlaying(true);
			music = 0;
			expect(g.effective).toBeCloseTo(0.02);
		});

		it('clamps the doubled value, so a high gate cannot stop opening at all', () => {
			// +6 dB from a gate above half the ceiling walks off the top of the
			// axis: unclamped, the meter pins its mark at 100% and the mic goes
			// dead the moment a track starts.
			const g = createGateSettings();
			g.setThreshold(GATE_CEIL);
			g.setDeckPlaying(true);
			expect(g.effective).toBe(GATE_CEIL);
		});
	});
});
