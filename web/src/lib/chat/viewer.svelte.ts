/**
 * The chat image viewer (#510): a picture in a message opens big on the page
 * it was sent on. It used to be an `<a target="_blank">`, and the browser then
 * hands the rider a bare `<img>` document with the room gone and the only way
 * back in the tab bar — the one piece of chrome someone three meters from the
 * screen cannot hit (rider report).
 *
 * One picture is open at a time; `ImageViewer` in the root layout draws it.
 */
export const image = $state<{
	/** The image URL. Empty means the viewer is closed. */
	src: string;
	alt: string;
	/**
	 * Shown at its own pixel size and scrolled instead of fit to the window:
	 * a screenshot fit to the height of a laptop is unreadable.
	 */
	actual: boolean;
}>({ src: '', alt: '', actual: false });

export function openImage(src: string, alt: string): void {
	image.src = src;
	image.alt = alt;
	// Every picture opens fit to the window — the last one's zoom is not an
	// opinion about this one.
	image.actual = false;
}

export function closeImage(): void {
	image.src = '';
	image.alt = '';
	image.actual = false;
}

export function toggleActual(): void {
	image.actual = !image.actual;
}
