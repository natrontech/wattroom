import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JukeboxEntry, JukeboxState } from '$lib/protocol';
import { createJukeboxChase, type ChaseHost } from './jukebox-chase';
import { playerInfo } from './jukebox-player.svelte';
import { listening, type Play } from './listening.svelte';
import { BUFFERING, PAUSED, PLAYING, UNSTARTED } from './youtube-api';

// The tiers themselves are playhead.test.ts's (#286). These cover what the
// chase adds on top: which player call each tier turns into, when a video is
// loaded rather than chased, and the local reasons a client stops chasing at
// all — fullscreen elsewhere, sitting out, a library track, no ticks.

const ANCHOR = 1_700_000_000_000;

/**
 * One clock for both readings the chase takes: `Date.now()` against the
 * room's anchor, and `performance.now()` for the settle windows. The latter
 * starts well past zero, as it does in any real tab — the autoplay watchdog
 * reads a zero as "never asked".
 */
const PERF_START = 5_000;
let clock = 0;
function pass(ms: number) {
	clock += ms;
}

let calls: string[] = [];
let player = {
	state: UNSTARTED as number,
	at: 0,
	duration: 0,
	rate: 1,
	live: false,
};

const embed = {
	loadVideoById: (id: string, start?: number) =>
		calls.push(`load ${id}@${start}`),
	cueVideoById: (id: string, start?: number) =>
		calls.push(`cue ${id}@${start}`),
	playVideo: () => calls.push('play'),
	pauseVideo: () => calls.push('pause'),
	stopVideo: () => calls.push('stop'),
	seekTo: (seconds: number) => calls.push(`seek ${seconds}`),
	getCurrentTime: () => player.at,
	getDuration: () => player.duration,
	getPlayerState: () => player.state,
	getPlaybackRate: () => player.rate,
	setPlaybackRate: (rate: number) => {
		player.rate = rate;
		calls.push(`rate ${rate}`);
	},
	getVideoData: () => ({ isLive: player.live }),
};

function track(over: Partial<JukeboxEntry> = {}): JukeboxEntry {
	return { id: 'e1', videoId: 'vid1', title: 'Warmup', addedBy: 'me', ...over };
}

/** A deck playing `vid1`, ten seconds in, with the anchor exactly now. */
function deck(over: Partial<JukeboxState> = {}): JukeboxState {
	return {
		queue: [],
		history: [],
		current: track(),
		playing: true,
		positionSec: 10,
		anchorMs: ANCHOR,
		...over,
	};
}

let ended: Play[] = [];
let loads = 0;
let host: ChaseHost & { deckNow: JukeboxState | null; hiddenNow: boolean };

function chaseOn(): ReturnType<typeof createJukeboxChase> {
	return createJukeboxChase(host);
}

beforeEach(() => {
	clock = 0;
	calls = [];
	ended = [];
	loads = 0;
	player = { state: UNSTARTED, at: 0, duration: 0, rate: 1, live: false };
	listening.rejoin();
	playerInfo.duration = 0;
	playerInfo.live = false;
	playerInfo.drift = 0;
	playerInfo.blocked = false;
	vi.spyOn(Date, 'now').mockImplementation(() => ANCHOR + clock);
	vi.spyOn(performance, 'now').mockImplementation(() => PERF_START + clock);
	host = {
		deckNow: deck(),
		hiddenNow: false,
		player: () => embed,
		deck: () => host.deckNow,
		hidden: () => host.hiddenNow,
		ended: (play) => ended.push(play),
		loaded: () => loads++,
	};
});
afterEach(() => vi.restoreAllMocks());

describe('the jukebox chase (#286)', () => {
	it('does nothing at all before the embed is ready', () => {
		host.player = () => null;
		chaseOn().tick();
		expect(calls).toEqual([]);
	});

	it('pauses this client while something else is fullscreen (#395)', () => {
		host.hiddenNow = true;
		player.state = PLAYING;
		chaseOn().tick();
		expect(calls).toEqual(['pause']);
	});

	it('drops a rate nudge when there are no ticks to chase', () => {
		host.deckNow = null;
		chaseOn().tick();
		expect(calls).toEqual(['rate 1']);
	});

	it("loads the deck's video at the room's playhead", () => {
		const chase = chaseOn();
		chase.tick();
		expect(calls).toEqual(['rate 1', 'load vid1@10']);
		expect(loads).toBe(1);
		expect(chase.playing).toEqual({ videoId: 'vid1', anchorMs: ANCHOR });
	});

	it('cues rather than loads while the room is paused, so nothing blasts', () => {
		host.deckNow = deck({ playing: false });
		chaseOn().tick();
		expect(calls).toEqual(['rate 1', 'cue vid1@10']);
	});

	it('treats the same video on a new anchor as a new play', () => {
		const chase = chaseOn();
		chase.tick();
		calls = [];
		host.deckNow = deck({ anchorMs: ANCHOR + 5_000, positionSec: 0 });
		pass(5_000);
		chase.tick();
		expect(calls).toEqual(['rate 1', 'load vid1@0']);
		expect(chase.playing).toEqual({
			videoId: 'vid1',
			anchorMs: ANCHOR + 5_000,
		});
	});

	it('leaves a library track to the audio deck, unloading what it holds (#267)', () => {
		const chase = chaseOn();
		chase.tick();
		calls = [];
		host.deckNow = deck({ current: track({ trackId: 'trk1' }) });
		chase.tick();
		expect(calls).toEqual(['stop']);
		expect(chase.playing).toBeNull();
	});

	it('seeks a real gap and nudges the rate on a small one', () => {
		const chase = chaseOn();
		chase.tick();
		player.state = PLAYING;
		player.duration = 300;
		// Past the settle, ten seconds behind the room: that earns a seek.
		pass(2_000);
		calls = [];
		player.at = 0;
		chase.tick();
		expect(calls).toEqual(['rate 1', 'seek 12']);
		expect(playerInfo.drift).toBeCloseTo(-12);

		// Half a second ahead closes on the rate instead of a stutter.
		pass(2_000);
		calls = [];
		player.at = 14.5;
		chase.tick();
		expect(calls).toEqual(['rate 0.95']);
	});

	it('measures nothing through a seek it has just asked for', () => {
		const chase = chaseOn();
		chase.tick();
		player.state = PLAYING;
		player.duration = 300;
		pass(500);
		calls = [];
		player.at = 0;
		chase.tick();
		expect(calls).toEqual([]);
	});

	it('re-seeks a paused deck that was scrubbed under it (#647)', () => {
		host.deckNow = deck({ playing: false });
		const chase = chaseOn();
		chase.tick();
		player.state = PAUSED;
		pass(2_000);
		calls = [];
		host.deckNow = deck({ playing: false, positionSec: 90 });
		chase.tick();
		expect(calls).toEqual(['seek 90']);
	});

	it('pauses a playing embed when the room stops', () => {
		const chase = chaseOn();
		chase.tick();
		player.state = BUFFERING;
		calls = [];
		host.deckNow = deck({ playing: false });
		chase.tick();
		expect(calls).toEqual(['pause']);
	});

	it('says a track the room ran off the end of is over', () => {
		const chase = chaseOn();
		chase.tick();
		player.state = PLAYING;
		player.duration = 12;
		pass(2_000);
		calls = [];
		host.deckNow = deck({ positionSec: 20 });
		chase.tick();
		expect(ended).toEqual([{ videoId: 'vid1', anchorMs: ANCHOR }]);
		expect(calls).toEqual([]);
	});

	it('rides the edge of a livestream instead of chasing an anchor', () => {
		const chase = chaseOn();
		chase.tick();
		player.state = PLAYING;
		player.live = true;
		player.duration = 4_000;
		pass(2_000);
		calls = [];
		player.at = 0;
		chase.tick();
		// The edge, once — and no drift correction afterwards.
		expect(calls).toEqual(['seek 4000']);
		expect(playerInfo.live).toBe(true);
		expect(playerInfo.duration).toBe(0);
		pass(2_000);
		calls = [];
		chase.tick();
		expect(calls).toEqual([]);
	});

	it('unloads for a rider sitting the track out, keeping the length they measured (#989)', () => {
		const chase = chaseOn();
		chase.tick();
		player.duration = 210;
		pass(2_000);
		chase.tick();
		calls = [];
		listening.stepOut('stop', { videoId: 'vid1', anchorMs: ANCHOR }, 210);
		chase.tick();
		expect(calls).toEqual(['stop']);
		expect(playerInfo.duration).toBe(210);
		// Out stays out: nothing is loaded, so nothing is chased.
		calls = [];
		chase.tick();
		expect(calls).toEqual([]);
	});

	it('marks the tab blocked when the browser refuses to start (#219)', () => {
		const chase = chaseOn();
		chase.tick();
		player.state = PAUSED;
		calls = [];
		pass(2_500);
		chase.tick();
		expect(calls).toContain('play');
		expect(playerInfo.blocked).toBe(true);
	});

	it('forgets its play when the iframe goes away', () => {
		const chase = chaseOn();
		chase.tick();
		player.duration = 210;
		pass(2_000);
		player.state = PLAYING;
		chase.tick();
		chase.reset();
		expect(chase.playing).toBeNull();
		expect(playerInfo.duration).toBe(0);
	});
});
