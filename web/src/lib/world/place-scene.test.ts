// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { placeScene } from './place-scene';

afterEach(() => vi.restoreAllMocks());

describe('placing the 3D view', () => {
	it('takes its canvas back and says why when the scene will not start', () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const host = document.createElement('div');
		const placed = placeScene(host, 'A world', () => {
			throw new Error('Error creating WebGL context.');
		});
		// null is the caller's cue to show an error with a retry, and the
		// blank canvas that stood there before is gone.
		expect(placed).toBeNull();
		expect(host.querySelector('canvas')).toBeNull();
		expect(logged).toHaveBeenCalledWith(
			'world: the 3D view did not start',
			expect.any(Error),
		);
	});

	it('hands the scene a labelled canvas, and removes both together', () => {
		const host = document.createElement('div');
		const dispose = vi.fn();
		let given: HTMLCanvasElement | null = null;
		const placed = placeScene(host, 'A world', (canvas) => {
			given = canvas;
			return { dispose };
		});
		expect(placed).not.toBeNull();
		expect(given).toBe(host.querySelector('canvas'));
		expect(host.querySelector('canvas')?.getAttribute('aria-label')).toBe(
			'A world',
		);
		placed?.remove();
		expect(dispose).toHaveBeenCalledOnce();
		expect(host.querySelector('canvas')).toBeNull();
	});
});
