/**
 * Mount a media track into a container, idempotently (#214).
 *
 * Svelte attachments re-run whenever their function identity changes — in a
 * room that is every tick, once a second. The old attach created a brand-new
 * <video> element per run and LiveKit kept a reference to every orphan:
 * visible flicker, then decoder exhaustion, then a dead tab. This mounts a
 * track exactly once per (container, track) pair; re-runs are no-ops, and a
 * genuine track change first detaches every stale element the track still
 * holds.
 */
interface Mountable {
	attach(): HTMLMediaElement;
	detach(): HTMLMediaElement[];
	mediaStreamTrack: MediaStreamTrack;
}

export function mountTrack(
	container: HTMLElement,
	track: Mountable | undefined,
	fit: 'cover' | 'contain',
): void {
	if (!track) {
		container.replaceChildren();
		return;
	}
	const id = track.mediaStreamTrack.id;
	const existing = container.firstElementChild as HTMLElement | null;
	if (existing?.dataset.trackId === id) return; // already showing this track
	track.detach(); // drop every stale element the track still references
	container.replaceChildren();
	const el = track.attach();
	el.dataset.trackId = id;
	el.style.width = '100%';
	el.style.height = '100%';
	el.style.objectFit = fit;
	container.appendChild(el);
}
