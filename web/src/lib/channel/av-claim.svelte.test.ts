import { describe, expect, it } from 'vitest';
import { createClaims, type ClaimParticipant } from './av-claim.svelte';

/**
 * The multi-tab claim protocol (#293), tested with no LiveKit mock — which is
 * the whole reason it came out of `av.svelte.ts` (#892). Three real bugs are
 * encoded in this protocol and each one gets a case here.
 */

function host(over: Partial<Parameters<typeof createClaims>[0]> = {}) {
	const log: string[] = [];
	let handedOff = false;
	let micOn = true;
	const base = {
		identity: () => 'jan#tab2',
		now: () => 2000,
		participants: (): ClaimParticipant[] => [],
		others: (): ClaimParticipant[] => [],
		announce: (at: number) => log.push(`announce:${at}`),
		handedOff: () => handedOff,
		setHandedOff: (next: boolean) => {
			handedOff = next;
			log.push(`handedOff:${next}`);
		},
		micOn: () => micOn,
		closeMic: () => {
			micOn = false;
			log.push('closeMic');
		},
		clearFault: () => log.push('clearFault'),
		closeCam: async () => void log.push('closeCam'),
		noteVoice: () => log.push('noteVoice'),
	};
	const claims = createClaims({ ...base, ...over });
	return {
		claims,
		log,
		get handedOff() {
			return handedOff;
		},
	};
}

describe('claiming', () => {
	it('stamps the claim on the server clock, not the browser', () => {
		// #646: the join stamps it competes with are LiveKit's. A browser clock
		// off by a second made the takeover read older than the incumbent.
		const h = host({ now: () => 9_999 });
		h.claims.claim();
		expect(h.claims.current).toEqual({ identity: 'jan#tab2', at: 9_999 });
		expect(h.log).toContain('announce:9999');
	});

	it('clears handedOff when it takes the mic back', () => {
		const h = host();
		h.claims.claim();
		expect(h.log).toContain('handedOff:false');
	});
});

describe('standing down', () => {
	it('yields to a newer tab of the same rider', async () => {
		const h = host();
		h.claims.current = { identity: 'jan#tab1', at: 1000 };
		h.claims.consider({ identity: 'jan#tab2', joinedAt: new Date(2000) });
		await Promise.resolve();
		expect(h.handedOff).toBe(true);
	});

	it('ignores an older tab, and anyone else entirely', async () => {
		const h = host();
		h.claims.current = { identity: 'jan#tab2', at: 2000 };
		h.claims.consider({ identity: 'jan#tab1', joinedAt: new Date(1000) });
		h.claims.consider({ identity: 'kim#tab9', joinedAt: new Date(9999) });
		await Promise.resolve();
		expect(h.handedOff).toBe(false);
	});

	it('puts down the mic and the camera, and keeps the note fresh', async () => {
		const h = host();
		await h.claims.standDown();
		expect(h.log).toEqual([
			'handedOff:true',
			'clearFault',
			'closeMic',
			'noteVoice',
			'closeCam',
		]);
	});

	it('remembers whether the mic was open, so taking back restores it', async () => {
		const open = host();
		await open.claims.standDown();
		expect(open.claims.micBeforeHandoff).toBe(true);

		const shut = host({ micOn: () => false });
		await shut.claims.standDown();
		expect(shut.claims.micBeforeHandoff).toBe(false);
		expect(shut.log).not.toContain('closeMic');
	});

	it('stands down once, however many newer tabs arrive', async () => {
		const h = host();
		h.claims.current = { identity: 'jan#tab1', at: 1000 };
		await h.claims.standDown();
		await h.claims.standDown();
		expect(h.log.filter((l) => l === 'closeCam')).toHaveLength(1);
	});
});

describe('micLive', () => {
	it("is true while another of the rider's tabs holds an open mic", () => {
		// Muting is unpublishing: without this the tab standing down reports
		// the rider muted everywhere, including where the mic actually is.
		const h = host({
			participants: () => [
				{ identity: 'jan#tab1', micOpen: false },
				{ identity: 'jan#tab2', micOpen: true },
			],
		});
		expect(h.claims.micLive('jan', 'jan#tab1')).toBe(true);
	});

	it('does not count the connection asking, nor another rider', () => {
		const h = host({
			participants: () => [
				{ identity: 'jan#tab1', micOpen: true },
				{ identity: 'kim#tab1', micOpen: true },
			],
		});
		expect(h.claims.micLive('jan', 'jan#tab1')).toBe(false);
	});
});

describe('stillHere', () => {
	it('sees another tab of the rider, and ignores the one asking', () => {
		const h = host({
			others: () => [{ identity: 'jan#tab1' }, { identity: 'kim#tab1' }],
		});
		expect(h.claims.stillHere('jan', 'jan#tab2')).toBe(true);
		expect(h.claims.stillHere('jan', 'jan#tab1')).toBe(false);
		expect(h.claims.stillHere('sara', 'jan#tab2')).toBe(false);
	});
});
