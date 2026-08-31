// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mountTrack } from './mount-track';

// A fake LiveKit track: counts attaches, remembers orphans like the real one.
function fakeTrack(id: string) {
	const attached: HTMLMediaElement[] = [];
	return {
		attaches: 0,
		mediaStreamTrack: { id } as MediaStreamTrack,
		attach() {
			this.attaches += 1;
			const el = document.createElement('video');
			attached.push(el);
			return el;
		},
		detach() {
			const dropped = attached.splice(0);
			return dropped;
		},
		get orphans() {
			return attached.length;
		},
	};
}

describe('mountTrack (#214)', () => {
	it('mounts once and re-runs are no-ops — the flicker/leak fix', () => {
		const container = document.createElement('div');
		const track = fakeTrack('t1');
		mountTrack(container, track, 'cover');
		const el = container.firstElementChild;
		// Attachments re-run every tick; 60 simulated seconds must not touch
		// the DOM or attach again.
		for (let i = 0; i < 60; i += 1) mountTrack(container, track, 'cover');
		expect(track.attaches).toBe(1);
		expect(container.firstElementChild).toBe(el);
		expect(track.orphans).toBe(1);
	});

	it('a new track replaces the old and drops its stale elements', () => {
		const container = document.createElement('div');
		const first = fakeTrack('t1');
		mountTrack(container, first, 'cover');
		const second = fakeTrack('t2');
		mountTrack(container, second, 'cover');
		expect(container.children.length).toBe(1);
		expect((container.firstElementChild as HTMLElement).dataset.trackId).toBe(
			't2',
		);
		expect(second.orphans).toBe(1);
	});

	it('undefined clears the container', () => {
		const container = document.createElement('div');
		mountTrack(container, fakeTrack('t1'), 'cover');
		mountTrack(container, undefined, 'cover');
		expect(container.children.length).toBe(0);
	});
});
