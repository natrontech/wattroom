/**
 * The one place the YouTube IFrame API gets loaded (#615). Two callers need
 * it now — the dock that plays and the resolver that reads a playlist — and
 * the script may only be injected once per document, so the queue of waiting
 * callbacks belongs here rather than in either of them.
 */

/** The player handle, as much of it as this app actually calls. */
export interface YTPlayer {
	destroy?: () => void;
	cuePlaylist?: (opts: { listType: string; list: string }) => void;
	getPlaylist?: () => string[] | null;
	// The playback half, used by the dock.
	loadVideoById?: (id: string, start?: number) => void;
	cueVideoById?: (id: string, start?: number) => void;
	[key: string]: unknown;
}

/** Run cb once `YT.Player` exists, loading the script if nobody has yet. */
export function withYouTubeApi(cb: () => void) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const w = window as any;
	if (w.YT?.Player) return cb();
	// Chaining rather than replacing: a second caller arriving before the
	// script lands must not silently drop the first one's callback.
	const existing = w.onYouTubeIframeAPIReady;
	w.onYouTubeIframeAPIReady = () => {
		existing?.();
		cb();
	};
	if (!document.querySelector('script[src*="iframe_api"]')) {
		const tag = document.createElement('script');
		tag.src = 'https://www.youtube.com/iframe_api';
		document.head.appendChild(tag);
	}
}
