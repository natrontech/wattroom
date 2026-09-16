/**
 * Dropping files on a surface (#2123): the two places that take a file by drag
 * — the board's clips face and the music library — had a hand-rolled copy each
 * of the same three handlers, and neither the highlight nor the fix for the
 * leave-on-a-child bug below was shared between them.
 *
 * What this does NOT own is what to do with the files, or which ones are
 * allowed: the board lets the server refuse and prints its wording, the
 * library checks locally before it uploads, and each is right for its own
 * surface (errors.md). The files come out as the `FileList` an
 * `<input type="file">` also hands over, so a surface with both doors keeps
 * one function behind them.
 */
export function fileDrop(onFiles: (files: FileList) => void) {
	let over = $state(false);
	return {
		/** True while a drag is over the surface — for the call site's highlight. */
		get over() {
			return over;
		},
		/** Spread onto the element that takes the drop: `<div {...drop.on}>`. */
		on: {
			ondragover(event: DragEvent) {
				// Without this there is no drop at all: the browser keeps its own
				// default and navigates away to the file, losing the page.
				event.preventDefault();
				over = true;
			},
			ondragleave(event: DragEvent) {
				// A leave fires for every child the pointer crosses on its way
				// across, so the highlight flickered off over each button and
				// paragraph inside the surface. The pointer has not left while the
				// element it moved onto is one of the surface's own.
				const to = event.relatedTarget;
				const surface = event.currentTarget;
				if (
					surface instanceof Node &&
					to instanceof Node &&
					surface.contains(to)
				)
					return;
				over = false;
			},
			ondrop(event: DragEvent) {
				event.preventDefault();
				over = false;
				const files = event.dataTransfer?.files;
				if (files?.length) onFiles(files);
			},
		},
	};
}
