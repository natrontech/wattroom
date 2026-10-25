import type { BrowserContext, Page } from '@playwright/test';

/**
 * The IFrame API, standing in for YouTube's (#3927): a player that plays what
 * it is given from where it is told, never ends and never errors, and shows
 * the video's own thumbnail where the video would be.
 */
const YOUTUBE_STUB = `
window.YT = { Player: class {
	constructor(node, opts) {
		this.node = typeof node === 'string' ? document.getElementById(node) : node;
		this.events = opts.events || {};
		this.state = -1; this.at = 0; this.since = 0;
		setTimeout(() => this.events.onReady?.({ target: this }));
	}
	show(id) {
		this.node.innerHTML = '<img src="https://i.ytimg.com/vi/' + id +
			'/mqdefault.jpg" alt="" style="width:100%;height:100%;object-fit:cover">';
	}
	go(state) { this.state = state; this.events.onStateChange?.({ data: state, target: this }); }
	loadVideoById(id, at = 0) { this.show(id); this.seekTo(at); this.go(1); }
	cueVideoById(id, at = 0) { this.show(id); this.seekTo(at); this.go(5); }
	playVideo() { this.since = Date.now(); this.go(1); }
	pauseVideo() { this.at = this.getCurrentTime(); this.go(2); }
	stopVideo() { this.pauseVideo(); }
	seekTo(at) { this.at = at; this.since = Date.now(); }
	getCurrentTime() { return this.state === 1 ? this.at + (Date.now() - this.since) / 1000 : this.at; }
	getDuration() { return 213; }
	getPlayerState() { return this.state; }
	getPlaybackRate() { return 1; }
	setPlaybackRate() {}
	getVideoData() { return { isLive: false }; }
	getVolume() { return 0; }
	setVolume() {}
	unloadModule() {}
	destroy() { this.node.innerHTML = ''; }
} };
window.onYouTubeIframeAPIReady?.();
`;

/** Serves YOUTUBE_STUB wherever `target` asks YouTube for its IFrame API. */
export async function stubYouTube(target: Page | BrowserContext) {
	await target.route('https://www.youtube.com/iframe_api', (route) =>
		route.fulfill({ contentType: 'text/javascript', body: YOUTUBE_STUB }),
	);
}
