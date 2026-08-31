import { describe, expect, it } from 'vitest';
import { micLiveElsewhere, riderOf, yieldsTo } from './tabs';

const jan = 'b1f0-jan';
const bea = 'c2a1-bea';

describe('riderOf (#293)', () => {
	it('reads the rider out of a per-connection identity', () => {
		expect(riderOf(`${jan}#a1b2c3`)).toBe(jan);
		expect(riderOf(`${jan}#a1b2c3`)).toBe(riderOf(`${jan}#ffffff`));
	});

	it('treats a nonce-less identity as its own rider', () => {
		// The server-to-server admin identity, and any pre-#293 connection
		// still in the room after a deploy.
		expect(riderOf(jan)).toBe(jan);
	});
});

describe('yieldsTo (#293)', () => {
	const mine = { identity: `${jan}#aaa`, at: 1000 };

	it('stands down for a newer tab of the same rider', () => {
		expect(yieldsTo(mine, { identity: `${jan}#bbb`, at: 1001 })).toBe(true);
	});

	it('keeps the mic against an older tab', () => {
		expect(yieldsTo(mine, { identity: `${jan}#bbb`, at: 999 })).toBe(false);
	});

	it('ignores other riders entirely', () => {
		expect(yieldsTo(mine, { identity: `${bea}#bbb`, at: 9999 })).toBe(false);
	});

	it('ignores its own claim echoed back', () => {
		expect(yieldsTo(mine, { identity: mine.identity, at: 9999 })).toBe(false);
	});

	it('leaves exactly one tab publishing when both claim at once', () => {
		// Same millisecond: whatever the tie-break decides, it must not decide
		// the same way for both tabs, or the rider goes silent in every one.
		const a = { identity: `${jan}#aaa`, at: 1000 };
		const b = { identity: `${jan}#bbb`, at: 1000 };
		expect(yieldsTo(a, b)).not.toBe(yieldsTo(b, a));
	});
});

describe('micLiveElsewhere (#293)', () => {
	const a = `${jan}#aaa`;
	const b = `${jan}#bbb`;

	it('keeps a rider live while their other tab holds the mic', () => {
		// The stood-down tab unpublishes; taking that at face value would read
		// the rider as muted in the very tab holding their microphone.
		const conns = [
			{ identity: a, micOpen: false },
			{ identity: b, micOpen: true },
		];
		expect(micLiveElsewhere(conns, jan, a)).toBe(true);
	});

	it('reports muted once no tab of theirs has an open mic', () => {
		const conns = [
			{ identity: a, micOpen: false },
			{ identity: b, micOpen: false },
		];
		expect(micLiveElsewhere(conns, jan, a)).toBe(false);
	});

	it('never counts the connection that just went quiet', () => {
		expect(micLiveElsewhere([{ identity: a, micOpen: true }], jan, a)).toBe(false);
	});

	it('never counts another rider', () => {
		expect(
			micLiveElsewhere([{ identity: `${bea}#ccc`, micOpen: true }], jan, a),
		).toBe(false);
	});
});
