// A canvas in `host` with a scene started on it. When the scene will not
// start — no WebGL, most often — no canvas is left behind, the reason goes
// to the console, and the caller gets null to show an error in its place.
export type Placed<S> = { scene: S; remove(): void };

export function placeScene<S extends { dispose(): void }>(
	host: HTMLElement,
	label: string,
	start: (canvas: HTMLCanvasElement) => S,
): Placed<S> | null {
	const canvas = document.createElement('canvas');
	canvas.style.display = 'block';
	canvas.style.width = '100%';
	canvas.style.height = '100%';
	canvas.setAttribute('role', 'img');
	canvas.setAttribute('aria-label', label);
	host.append(canvas);
	let scene: S;
	try {
		scene = start(canvas);
	} catch (err) {
		console.error('world: the 3D view did not start', err);
		canvas.remove();
		return null;
	}
	return {
		scene,
		remove() {
			scene.dispose();
			canvas.remove();
		},
	};
}
