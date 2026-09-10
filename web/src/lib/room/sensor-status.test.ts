import { describe, expect, it } from 'vitest';
import type { SensorPairing } from '$lib/protocol';
import { mayActuate, pairedElsewhere } from '$lib/room/sensor-status';

describe('pairedElsewhere', () => {
	const held = (elsewhere: Record<string, string>): SensorPairing => ({
		elsewhere,
	});

	it('names the rider’s other device', () => {
		expect(
			pairedElsewhere('trainer', held({ trainer: 'phone' }), 'desktop'),
		).toBe('on your phone');
	});

	it('says "another tab" rather than naming the screen you are on', () => {
		// "Paired on your desktop", read at the desktop, is a riddle (#610).
		expect(
			pairedElsewhere('trainer', held({ trainer: 'desktop' }), 'desktop'),
		).toBe('in another tab');
	});

	it('is silent for a kind this screen is free to pair', () => {
		expect(
			pairedElsewhere('heart-rate', held({ trainer: 'phone' }), 'desktop'),
		).toBeUndefined();
	});

	it('is silent with no room connection at all', () => {
		// The solo /ride and /ramp screens hold no socket and must keep their
		// pair buttons.
		expect(pairedElsewhere('trainer', undefined, 'desktop')).toBeUndefined();
		expect(pairedElsewhere('trainer', {}, 'desktop')).toBeUndefined();
	});
});

describe('mayActuate (#1853)', () => {
	it('refuses the screen whose claim the hub gave to another', () => {
		expect(mayActuate({ elsewhere: { trainer: 'phone' } })).toBe(false);
	});

	it('lets the granted screen drive', () => {
		expect(mayActuate({ held: ['trainer'] })).toBe(true);
	});

	it('cares only about the trainer', () => {
		// A strap held on the phone says nothing about who writes the
		// control point.
		expect(mayActuate({ elsewhere: { 'heart-rate': 'phone' } })).toBe(true);
	});

	it('rides as before when the hub has arbitrated nothing', () => {
		// The hub's own rule (ownsTrainerLocked): no claim, no refusal. The
		// solo screens, and a tab whose answer has not arrived or whose
		// socket is down, keep their resistance.
		expect(mayActuate(undefined)).toBe(true);
		expect(mayActuate({})).toBe(true);
	});
});
