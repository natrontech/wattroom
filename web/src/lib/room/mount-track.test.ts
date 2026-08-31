// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mountTrack } from './mount-track';

// A fake LiveKit track: counts attaches, remembers its elements like the real
// one, and detaches per element.
function fakeTrack(id: string) {
	return {
		attaches: 0,
		attachedElements: [] as HTMLMediaElement[],
		mediaStreamTrack: { id } as MediaStreamTrack,
		attach() {
			this.attaches += 1;
			const el = document.createElement('video');
			this.attachedElements.push(el);
			return el;
		},
		detach(element: HTMLMediaElement) {
			this.attachedElements = this.attachedElements.filter(
				(el) => el !== element,
			);
			element.remove();
			return element;
		},
		get orphans() {
			return this.attachedElements.length;
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
		expect(first.orphans).toBe(0);
		expect(second.orphans).toBe(1);
	});

	it('undefined clears the container', () => {
		const container = document.createElement('div');
		mountTrack(container, fakeTrack('t1'), 'cover');
		mountTrack(container, undefined, 'cover');
		expect(container.children.length).toBe(0);
	});

	// #335: the stage and the rider tile show the same camera. Putting it on
	// the stage used to detach every element the track held — the tile below
	// went black, and the next tick blanked the stage right back.
	it('a second container does not steal the track from the first', () => {
		const tile = document.createElement('div');
		const stage = document.createElement('div');
		document.body.append(tile, stage);
		const cam = fakeTrack('cam');
		mountTrack(tile, cam, 'cover');
		mountTrack(stage, cam, 'contain');
		expect(tile.children.length).toBe(1);
		expect(stage.children.length).toBe(1);
		expect(cam.attaches).toBe(2);
		// And both stay put while the attachments re-run every tick.
		for (let i = 0; i < 10; i += 1) {
			mountTrack(tile, cam, 'cover');
			mountTrack(stage, cam, 'contain');
		}
		expect(cam.attaches).toBe(2);
		expect(tile.children.length).toBe(1);
		expect(stage.children.length).toBe(1);
		tile.remove();
		stage.remove();
	});

	it('sweeps elements whose container was thrown away by a {#key} block', () => {
		const gone = document.createElement('div');
		const live = document.createElement('div');
		document.body.append(live);
		const track = fakeTrack('t1');
		mountTrack(gone, track, 'cover'); // never in the document
		mountTrack(live, track, 'cover');
		expect(track.orphans).toBe(1);
		live.remove();
	});
});
