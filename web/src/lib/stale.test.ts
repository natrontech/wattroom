import { describe, expect, it } from 'vitest';
import { latestRead, pingFollower } from './stale';

/** A read held open until the test lands it; `began` counts the reads asked. */
function heldRead() {
	const land: (() => void)[] = [];
	const feed = {
		began: 0,
		land: (n: number) => land[n](),
		read: () => {
			feed.began += 1;
			return new Promise<void>((resolve) => land.push(resolve));
		},
	};
	return feed;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('one read at a time (#4565)', () => {
	it('starts the first read at once', () => {
		const feed = heldRead();
		void latestRead(feed.read)();
		expect(feed.began).toBe(1);
	});

	it('answers a burst during a read with one more, begun after the last ask', async () => {
		const feed = heldRead();
		const ask = latestRead(feed.read);
		void ask();
		void ask();
		void ask();
		const last = ask();
		expect(feed.began).toBe(1);
		feed.land(0);
		await settle();
		// One read for the three asks, and it began after all of them.
		expect(feed.began).toBe(2);
		let landed = false;
		void last.then(() => (landed = true));
		await settle();
		expect(landed).toBe(false);
		feed.land(1);
		await settle();
		expect(landed).toBe(true);
		expect(feed.began).toBe(2);
	});

	it('reads at once again when nothing is in flight', async () => {
		const feed = heldRead();
		const ask = latestRead(feed.read);
		void ask();
		feed.land(0);
		await settle();
		void ask();
		expect(feed.began).toBe(2);
	});

	it('keeps going after a read that threw', async () => {
		let began = 0;
		const ask = latestRead(async () => {
			began += 1;
			throw new Error('refused');
		});
		await ask();
		await ask();
		expect(began).toBe(2);
	});

	it('drops what was queued on reset, and starts fresh', async () => {
		const feed = heldRead();
		const ask = latestRead(feed.read);
		void ask();
		void ask();
		ask.reset();
		feed.land(0);
		await settle();
		expect(feed.began).toBe(1);
		void ask();
		expect(feed.began).toBe(2);
	});
});

describe('a follower of the lobby ping', () => {
	it('reads on mount, skips the feed’s first answer, then reads every ping', () => {
		const reads = pingFollower();
		expect(reads(0)).toBe(true);
		expect(reads(0)).toBe(false);
		expect(reads(1)).toBe(false);
		expect(reads(2)).toBe(true);
		expect(reads(2)).toBe(false);
		expect(reads(3)).toBe(true);
	});

	it('mounted on a feed already answering, reads every ping', () => {
		const reads = pingFollower();
		expect(reads(4)).toBe(true);
		expect(reads(5)).toBe(true);
	});
});
