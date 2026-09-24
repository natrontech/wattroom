import { describe, expect, it } from 'vitest';
import { crewOf, followedRider } from './follow';
import type { LiveRider } from '$lib/channel/types';

const rider = (id: string, over: Partial<LiveRider> = {}): LiveRider =>
	({ id, name: id, watts: 0, ftp: 200, you: false, ...over }) as LiveRider;

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

	it('has nobody to follow in an empty voice channel', () => {
		expect(followedRider([], null)).toBeNull();
	});

	it('ignores a focus on someone who left', () => {
		const riders = [rider('a', { watts: 100 })];
		expect(followedRider(riders, 'gone')?.id).toBe('a');
	});
});

describe('crewOf', () => {
	const ids = (riders: LiveRider[]) => riders.map((r) => r.id);

	// #2655: the strip was the only camera on the Training place, and it left
	// you out, so a rider never saw their own picture.
	it('puts you first while your camera is on', () => {
		const riders = [rider('a'), rider('me', { you: true, cameraOn: true })];
		expect(ids(crewOf(riders, false))).toEqual(['me', 'a']);
	});

	it('leaves you out without a camera where the instrument is yours', () => {
		const riders = [rider('a'), rider('me', { you: true, watts: 200 })];
		expect(ids(crewOf(riders, false))).toEqual(['a']);
	});

	it('keeps you while you pedal on the phone', () => {
		const riders = [rider('a'), rider('me', { you: true, watts: 200 })];
		expect(ids(crewOf(riders, true))).toEqual(['me', 'a']);
	});

	it('leaves a spectator with no camera out on the phone', () => {
		const riders = [rider('a'), rider('me', { you: true })];
		expect(ids(crewOf(riders, true))).toEqual(['a']);
	});
});
