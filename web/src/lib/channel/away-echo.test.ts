import { describe, expect, it } from 'vitest';
import { applyAway, AWAY_ECHO_TICKS, noEcho, pressed } from './away-echo';

describe('applyAway', () => {
	it('believes the roster when nothing is pending', () => {
		expect(applyAway(true, noEcho).apply).toBe(true);
		expect(applyAway(false, noEcho).apply).toBe(true);
	});

	// The bug: the tick already in flight still carried the old value, and
	// applying it ran the come-back branch — the mix unmuted and the mic
	// re-opened itself a fifth of a second after the rider pressed Away.
	it('holds the press against the echo of the state it just left', () => {
		const after = applyAway(false, pressed(true));
		expect(after.apply).toBe(false);
		expect(after.echo.wanted).toBe(true);
	});

	it('stops waiting once the server agrees', () => {
		const after = applyAway(true, pressed(true));
		expect(after.apply).toBe(true);
		expect(after.echo).toEqual(noEcho);
	});

	// …and once it has stopped, the roster is believed again — which is the
	// whole reason that effect exists (#807): away pressed on the rider's
	// phone has to reach their desk. Ignoring the roster forever would have
	// fixed the bug by removing the feature.
	it('believes a later change from another screen', () => {
		const agreed = applyAway(true, pressed(true)).echo;
		const later = applyAway(false, agreed);
		expect(later.apply).toBe(true);
	});

	// The bound. A message the server never received must not pin this screen
	// to a wish forever.
	it('gives up after enough ticks disagree, and not before', () => {
		let echo = pressed(true);
		for (let i = 0; i < AWAY_ECHO_TICKS; i++) {
			const step = applyAway(false, echo);
			expect(step.apply).toBe(false);
			echo = step.echo;
		}
		const last = applyAway(false, echo);
		expect(last.apply).toBe(true);
		expect(last.echo).toEqual(noEcho);
	});

	it('counts only ticks that disagree', () => {
		// An agreeing tick resolves the wait outright rather than spending one
		// of its chances.
		expect(applyAway(true, { wanted: true, waited: 4 }).echo).toEqual(noEcho);
	});
});
