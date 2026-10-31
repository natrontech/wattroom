/**
 * The lounge's clock: a frame every 1/15 s, the genre's pace and a fraction
 * of the world's cost, or one a second for a held picture under reduced
 * motion. The browser stops animation frames in a hidden tab, so a tab out of
 * sight costs nothing. Returns the stop.
 */
const FRAME_MS = 1000 / 15;
const HELD_MS = 1000;

export function sceneLoop(
	canvas: HTMLCanvasElement,
	draw: (g: CanvasRenderingContext2D, dt: number) => void,
	still: boolean,
): () => void {
	const g = canvas.getContext('2d');
	if (!g) return () => {};
	const every = still ? HELD_MS : FRAME_MS;
	// A timer between frames: an animation frame alone would wake the page at
	// the display's 120 or 165 Hz only to skip most of them.
	let raf = 0;
	let timer = 0;
	let last = performance.now();
	const tick = (now: number) => {
		draw(g, (now - last) / 1000);
		last = now;
		timer = window.setTimeout(
			() => (raf = requestAnimationFrame(tick)),
			Math.max(0, every - (performance.now() - now)),
		);
	};
	draw(g, 0);
	timer = window.setTimeout(() => (raf = requestAnimationFrame(tick)), every);
	return () => {
		clearTimeout(timer);
		cancelAnimationFrame(raf);
	};
}
