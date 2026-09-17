import { describe, expect, it } from 'vitest';
import type { SensorPairing } from '$lib/protocol';
import {
	mayActuate,
	pairedElsewhere,
	trainerTargetsNote,
} from '$lib/room/sensor-status';

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

describe('trainerTargetsNote (#2075)', () => {
	// A screen that keeps its GATT link and writes no control point drew the
	// ordinary live card: name, watts and Forget, and nothing at all about
	// where the resistance was coming from.
	it('names the screen the targets come from', () => {
		expect(
			trainerTargetsNote({ elsewhere: { trainer: 'phone' } }, 'desktop'),
		).toBe('Targets come from your phone');
	});

	it('says "another tab" rather than naming the screen you are on', () => {
		expect(
			trainerTargetsNote({ elsewhere: { trainer: 'desktop' } }, 'desktop'),
		).toBe('Targets come from another tab');
	});

	it('is silent on the screen that is driving', () => {
		expect(
			trainerTargetsNote({ held: ['trainer'] }, 'desktop'),
		).toBeUndefined();
		expect(trainerTargetsNote(undefined, 'desktop')).toBeUndefined();
		expect(
			trainerTargetsNote({ elsewhere: { 'heart-rate': 'phone' } }, 'desktop'),
		).toBeUndefined();
	});

	it('is the same claim mayActuate refuses on', () => {
		// Two answers to one question would drift: a card saying the targets
		// are elsewhere while this screen still wrote them is the bug this
		// came from, one layer up.
		const pairing = { elsewhere: { trainer: 'phone' } };
		expect(!!trainerTargetsNote(pairing, 'desktop')).toBe(!mayActuate(pairing));
	});
});
