/**
 * Mount a media track into a container, idempotently (#214).
 *
 * Svelte attachments re-run whenever their function identity changes — in a
 * room that is every tick, once a second. The old attach created a brand-new
 * <video> element per run and LiveKit kept a reference to every orphan:
 * visible flicker, then decoder exhaustion, then a dead tab. This mounts a
 * track exactly once per (container, track) pair; re-runs are no-ops.
 *
 * One track can be on screen in several places at once — a rider's camera
 * lives in their tile AND on the stage the moment someone picks it. So a
 * container only ever detaches the element IT put up: a bare `detach()`
 * rips the track out of every other container too, which is how picking a
 * source blanked the tiles underneath (#335).
 */
interface Mountable {
	attach(): HTMLMediaElement;
	detach(element: HTMLMediaElement): HTMLMediaElement;
	attachedElements: HTMLMediaElement[];
	mediaStreamTrack: MediaStreamTrack;
}

/** Which track put an element up, so we hand it back to the right owner. */
const mountedBy = new WeakMap<HTMLMediaElement, Mountable>();

export function mountTrack(
	container: HTMLElement,
	track: Mountable | undefined,
	fit: 'cover' | 'contain',
): void {
	const existing = container.firstElementChild as HTMLMediaElement | null;
	if (existing?.dataset.trackId === track?.mediaStreamTrack.id) return;
	if (existing) mountedBy.get(existing)?.detach(existing);
	container.replaceChildren();
	if (!track) return;
	// A {#key} block throws its container away without telling LiveKit; sweep
	// what it left behind before adding one more (#214).
	for (const stale of track.attachedElements)
		if (!stale.isConnected) track.detach(stale);
	const el = track.attach();
	mountedBy.set(el, track);
	el.dataset.trackId = track.mediaStreamTrack.id;
	el.style.width = '100%';
	el.style.height = '100%';
	el.style.objectFit = fit;
	container.appendChild(el);
}
