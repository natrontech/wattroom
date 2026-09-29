import { describe, expect, it } from 'vitest';
import { crewOf } from './follow';
import type { LiveRider } from '$lib/channel/types';

const rider = (id: string, over: Partial<LiveRider> = {}): LiveRider =>
	({ id, name: id, watts: 0, ftp: 200, you: false, ...over }) as LiveRider;

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

	// #2882 L6-13: on a 375 px screen your watts, rpm and w/kg were drawn
	// twice — the instrument follows you while you pedal, and your tile
	// repeated it underneath.
	it('leaves you out on the phone when the instrument already follows you', () => {
		const riders = [rider('a'), rider('me', { you: true, watts: 200 })];
		expect(ids(crewOf(riders, true, 'me'))).toEqual(['a']);
	});

	it('keeps you on the phone while the instrument follows someone else', () => {
		const riders = [rider('a'), rider('me', { you: true, watts: 200 })];
		expect(ids(crewOf(riders, true, 'a'))).toEqual(['me', 'a']);
	});

	it('leaves a spectator with no camera out on the phone', () => {
		const riders = [rider('a'), rider('me', { you: true })];
		expect(ids(crewOf(riders, true))).toEqual(['a']);
	});
});
