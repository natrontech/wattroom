import { describe, expect, it } from 'vitest';
import { followedRider } from './follow';
import type { RoomRider } from './view';

const rider = (id: string, over: Partial<RoomRider> = {}): RoomRider =>
	({ id, name: id, watts: 0, ftp: 200, you: false, ...over }) as RoomRider;

describe('followedRider', () => {
	it('follows the rider you tapped', () => {
		const riders = [rider('a', { watts: 300 }), rider('b', { watts: 100 })];
		expect(followedRider(riders, 'b')?.id).toBe('b');
	});

	it('follows you while you are pedalling', () => {
		const riders = [
			rider('a', { watts: 300 }),
			rider('me', { watts: 120, you: true }),
		];
		expect(followedRider(riders, null)?.id).toBe('me');
	});

	// The spectator case: a phone has no trainer, so "you" is 0 W and the
	// screen would be a needle pinned at zero.
	it('follows the hardest rider when you have no watts', () => {
		const riders = [
			rider('me', { you: true }),
			rider('a', { watts: 240, ftp: 300 }),
			rider('b', { watts: 200, ftp: 200 }),
		];
		expect(followedRider(riders, null)?.id).toBe('b');
	});

	// %FTP, not raw watts — the fair ordering docs/SPEC.md uses everywhere.
	it('ranks by %FTP, so the bigger rider does not lead by existing', () => {
		const riders = [
			rider('big', { watts: 320, ftp: 400 }),
			rider('small', { watts: 180, ftp: 200 }),
		];
		expect(followedRider(riders, null)?.id).toBe('small');
	});

	it('falls back to the first rider before anyone pedals', () => {
		expect(followedRider([rider('a'), rider('b')], null)?.id).toBe('a');
	});

	it('has nobody to follow in an empty room', () => {
		expect(followedRider([], null)).toBeNull();
	});

	it('ignores a focus on someone who left', () => {
		const riders = [rider('a', { watts: 100 })];
		expect(followedRider(riders, 'gone')?.id).toBe('a');
	});
});
