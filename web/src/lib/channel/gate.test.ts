import { describe, expect, it } from 'vitest';
import {
	ENV_ATTACK_MS,
	ENV_RELEASE_MS,
	GATE_HOLD_MS,
	GATE_SHUT,
	closeLevel,
	envelope,
	gateStep,
} from './gate';

const OPEN_AT = 0.02; // SPEC's default threshold
const UNDER = closeLevel(OPEN_AT) * 0.5; // room tone, well beneath the gate

describe('gate dynamics (#514)', () => {
	it('opens on the first level over the mark', () => {
		const open = gateStep(GATE_SHUT, OPEN_AT, OPEN_AT, 1_000);
		expect(open.open).toBe(true);
		expect(open.loudAt).toBe(1_000);
	});

	it('does not open on a level that only clears the close mark', () => {
		// Hysteresis lowers the bar for staying open, never for getting in.
		const between = closeLevel(OPEN_AT) * 1.1;
		expect(gateStep(GATE_SHUT, between, OPEN_AT, 1_000).open).toBe(false);
	});

	it('stays open on a level between the two marks', () => {
		const open = gateStep(GATE_SHUT, OPEN_AT, OPEN_AT, 0);
		const quieter = gateStep(open, closeLevel(OPEN_AT) * 1.1, OPEN_AT, 500);
		expect(quieter.open).toBe(true);
		// Still loud enough to hold it, so the hang has not started.
		expect(quieter.loudAt).toBe(500);
	});

	it('rides through a gap shorter than the hang', () => {
		let state = gateStep(GATE_SHUT, OPEN_AT, OPEN_AT, 0);
		for (let t = 20; t < GATE_HOLD_MS; t += 20) {
			state = gateStep(state, UNDER, OPEN_AT, t);
		}
		expect(state.open).toBe(true);
	});

	it('closes once the gap outlasts the hang', () => {
		let state = gateStep(GATE_SHUT, OPEN_AT, OPEN_AT, 0);
		state = gateStep(state, UNDER, OPEN_AT, GATE_HOLD_MS - 1);
		expect(state.open).toBe(true);
		state = gateStep(state, UNDER, OPEN_AT, GATE_HOLD_MS);
		expect(state.open).toBe(false);
	});

	it('re-opens immediately after a close', () => {
		let state = gateStep(GATE_SHUT, OPEN_AT, OPEN_AT, 0);
		state = gateStep(state, UNDER, OPEN_AT, GATE_HOLD_MS);
		expect(state.open).toBe(false);
		state = gateStep(state, OPEN_AT, OPEN_AT, GATE_HOLD_MS + 20);
		expect(state.open).toBe(true);
	});

	it('holds against a threshold the jukebox moved', () => {
		// #478 doubles the mark while music plays; the close mark follows it.
		const doubled = OPEN_AT * 2;
		expect(gateStep(GATE_SHUT, OPEN_AT, doubled, 0).open).toBe(false);
		const open = gateStep(GATE_SHUT, doubled, doubled, 0);
		expect(gateStep(open, closeLevel(doubled) * 1.1, doubled, 20).open).toBe(
			true,
		);
	});
});

describe('level envelope (#514)', () => {
	it('takes a syllable on within a few milliseconds', () => {
		// One attack constant gets most of the way there; the gate must not
		// wait for the meter to catch up before it opens.
		const after = envelope(0, 1, ENV_ATTACK_MS);
		expect(after).toBeGreaterThan(0.6);
	});

	it('falls slowly enough to bridge a consonant', () => {
		const after = envelope(1, 0, 30);
		expect(after).toBeGreaterThan(0.5);
		expect(envelope(1, 0, ENV_RELEASE_MS * 4)).toBeLessThan(0.05);
	});

	it('takes the level itself when no time has passed', () => {
		expect(envelope(0.4, 0.9, 0)).toBe(0.9);
	});
});
