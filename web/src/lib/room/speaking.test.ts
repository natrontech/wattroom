import { describe, expect, it } from 'vitest';
import {
	createSpeaking,
	SPEAKING_AT,
	SPEAKING_HOLD_MS,
} from '$lib/room/speaking';

// Two tabs of Marco's, one of Ana's — the shape #293 made real.
const riderOf = (identity: string) => identity.split('#')[0];

const LOUD = SPEAKING_AT * 4;
const QUIET = SPEAKING_AT / 4;

describe('who is talking', () => {
	it('lights a rider on the first reading over the mark', () => {
		const talk = createSpeaking(riderOf);
		expect(talk.level('marco#1', QUIET, 0)).toBe(false);
		expect(talk.riders).toEqual({});
		expect(talk.level('marco#1', LOUD, 20)).toBe(true);
		expect(talk.riders).toEqual({ marco: true });
	});

	it('rides the gap between words, then goes out', () => {
		const talk = createSpeaking(riderOf);
		talk.level('marco#1', LOUD, 0);
		// A breath, well inside the hang.
		expect(talk.level('marco#1', QUIET, 100)).toBe(false);
		expect(talk.riders).toEqual({ marco: true });
		expect(talk.level('marco#1', QUIET, SPEAKING_HOLD_MS + 40)).toBe(true);
		expect(talk.riders).toEqual({});
	});

	it('says nothing changed while nothing changed', () => {
		const talk = createSpeaking(riderOf);
		talk.level('marco#1', LOUD, 0);
		// Fifty readings a second, per rider: the caller must not write state
		// for each one.
		for (let t = 20; t < 200; t += 20)
			expect(talk.level('marco#1', LOUD, t)).toBe(false);
	});

	// The bug this exists for. The flag was a remembered broadcast, so it
	// outlived its subject: a rider who left mid-sentence stayed ringed until
	// the room ended.
	it('goes out the moment the connection does, mid-sentence', () => {
		const talk = createSpeaking(riderOf);
		talk.level('marco#1', LOUD, 0);
		expect(talk.riders).toEqual({ marco: true });
		expect(talk.drop('marco#1')).toBe(true);
		expect(talk.riders).toEqual({});
	});

	it('knows nothing about a connection it never heard', () => {
		const talk = createSpeaking(riderOf);
		expect(talk.drop('nobody#1')).toBe(false);
	});

	it('is one voice per rider, whatever a rider has open', () => {
		const talk = createSpeaking(riderOf);
		talk.level('marco#1', LOUD, 0);
		talk.level('marco#2', QUIET, 0);
		expect(talk.riders).toEqual({ marco: true });
		// The tab that was talking closes; the quiet one must not keep him lit.
		expect(talk.drop('marco#1')).toBe(true);
		expect(talk.riders).toEqual({});
	});

	it('keeps a rider lit while their other tab is still talking', () => {
		const talk = createSpeaking(riderOf);
		talk.level('marco#1', LOUD, 0);
		talk.level('marco#2', LOUD, 0);
		expect(talk.drop('marco#2')).toBe(false);
		expect(talk.riders).toEqual({ marco: true });
	});

	it('keeps riders apart', () => {
		const talk = createSpeaking(riderOf);
		talk.level('marco#1', LOUD, 0);
		talk.level('ana#1', LOUD, 0);
		expect(talk.riders).toEqual({ marco: true, ana: true });
		talk.level('marco#1', QUIET, SPEAKING_HOLD_MS + 40);
		expect(talk.riders).toEqual({ ana: true });
	});

	it('empties on the way out of the room', () => {
		const talk = createSpeaking(riderOf);
		talk.level('marco#1', LOUD, 0);
		talk.clear();
		expect(talk.riders).toEqual({});
		// And starts clean rather than remembering the gate it left open.
		expect(talk.level('marco#1', QUIET, 0)).toBe(false);
		expect(talk.riders).toEqual({});
	});

	// Once open, the gate holds on a lower mark so a level hovering at the
	// threshold cannot chatter the ring on and off.
	it('holds open on a level that would not have opened it', () => {
		const talk = createSpeaking(riderOf);
		talk.level('marco#1', LOUD, 0);
		const justUnder = SPEAKING_AT * 0.7;
		talk.level('marco#1', justUnder, SPEAKING_HOLD_MS * 3);
		expect(talk.riders).toEqual({ marco: true });
	});
});
