import { setDuckLevel, setVolume as setCueVolume } from '$lib/sound/cues';
import { DUCK_DEFAULT } from '$lib/sound/ducking';
import { mixerStorage } from '$lib/sound/mixer-storage';

/**
 * The mix has one owner (#179, #152): music, cues, and each rider's voice
 * set here, applied by their outputs. Ducking still happens ON TOP of the
 * music level — the mixer sets the ceiling, the ducker dips under it.
 * Per-device, persisted: a mix is ears, not account state.
 */

/** A rider's fader, 0–2 — above 1 is the "make them louder" ask (#463). */
const RIDER_GAIN_MAX = 2;

function load(): {
	music: number;
	cues: number;
	board: number;
	duck: number;
	duckSelf: boolean;
	riders: Record<string, number>;
	names: Record<string, string>;
} {
	try {
		const raw = JSON.parse(mixerStorage.read() ?? '{}');
		const riders: Record<string, number> = {};
		const names: Record<string, string> = {};
		for (const [id, gain] of Object.entries(raw.riders ?? {})) {
			// Unity is the default, so an entry AT unity is a leftover, not a
			// mix — and junk falls back to unity, which is the same thing.
			const g = clamp(gain, 0, RIDER_GAIN_MAX, 1);
			if (g === 1) continue;
			riders[id] = g;
			const name = raw.names?.[id];
			if (typeof name === 'string' && name) names[id] = name;
		}
		return {
			music: clamp(raw.music, 0, 100, 70),
			cues: clamp(raw.cues, 0, 1, 0.7),
			board: clamp(raw.board, 0, 1, 0.7),
			duck: clamp(raw.duck, 0, 1, DUCK_DEFAULT),
			duckSelf: raw.duckSelf === true,
			riders,
			names,
		};
	} catch {
		return {
			music: 70,
			cues: 0.7,
			board: 0.7,
			duck: DUCK_DEFAULT,
			duckSelf: false,
			riders: {},
			names: {},
		};
	}
}

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
	return typeof v === 'number' && v >= lo && v <= hi ? v : fallback;
}

let music = $state(70);
let cues = $state(0.7);
/**
 * The soundboard's level (#877, ADR-0033), 0–1. Its OWN channel, never the
 * cues fader: a quiet ride must not silence the board, and turning the board
 * down must not cost the rider their countdown.
 */
let board = $state(0.7);
let duck = $state(DUCK_DEFAULT);
let duckSelf = $state(false);
let riders = $state<Record<string, number>>({});
/**
 * Stepped out (#706, #875): everything the room plays goes quiet on this
 * device — voices, music, cues — because a rider who is not there is not
 * there to turn it down. The faders keep their values, so coming back
 * restores the mix they set and never a default. Not persisted: away is
 * where the rider is, not how they like the mix.
 */
let muted = $state(false);
// Who a stored fader belongs to, so the profile mixer can name a rider who
// is not in the room right now.
let names = $state<Record<string, string>>({});
const initial = load();
music = initial.music;
cues = initial.cues;
board = initial.board;
duck = initial.duck;
duckSelf = initial.duckSelf;
riders = initial.riders;
names = initial.names;
setCueVolume(cues);
setDuckLevel(duck);

function persist() {
	mixerStorage.write(
		JSON.stringify({ music, cues, board, duck, duckSelf, riders, names }),
	);
}

export const mixer = {
	/** Jukebox ceiling, 0–100 (the YouTube player's scale). */
	get music() {
		return music;
	},
	setMusic(v: number) {
		music = Math.min(100, Math.max(0, Math.round(v)));
		persist();
	},
	/** Cue mixer level, 0–1. */
	get cues() {
		return cues;
	},
	setCues(v: number) {
		cues = Math.min(1, Math.max(0, v));
		setCueVolume(muted ? 0 : cues);
		persist();
	},
	/** Soundboard level, 0–1 — see the note on the state above. */
	get board() {
		return board;
	},
	setBoard(v: number) {
		board = Math.min(1, Math.max(0, v));
		persist();
	},
	/** Silent while the rider is away — the outputs each read this. */
	get muted() {
		return muted;
	},
	setMuted(on: boolean) {
		muted = on;
		setCueVolume(on ? 0 : cues);
	},
	/**
	 * How far music and cues dip while someone is speaking (#280), 0–1:
	 * 0 silences them under a voice, 1 turns ducking off. One knob for both,
	 * because "how hard does it duck" is one question to a rider.
	 */
	get duck() {
		return duck;
	},
	setDuck(v: number) {
		duck = Math.min(1, Math.max(0, v));
		setDuckLevel(duck);
		persist();
	},
	/**
	 * Whether your own voice ducks the room too (#867). Off: the music and the
	 * cues dip for other riders only, which is what the app has always done —
	 * hearing the mix drop every time you open your mouth is a taste, and a
	 * coach talking over a set is the one who has it.
	 */
	get duckSelf() {
		return duckSelf;
	},
	setDuckSelf(on: boolean) {
		duckSelf = on;
		persist();
	},
	/** Per-rider voice gain, 0–2; 1 (unity) for anyone never adjusted. */
	riderGain(id: string): number {
		return riders[id] ?? 1;
	},
	/**
	 * Unity is the default, so setting a rider back to 1 forgets them — the
	 * "riders you have adjusted" list is exactly what is stored. The name
	 * rides along so that list can say who, after they have left.
	 */
	setRiderGain(id: string, v: number, name?: string) {
		const gain = Math.min(RIDER_GAIN_MAX, Math.max(0, v));
		const nextRiders = { ...riders };
		const nextNames = { ...names };
		if (gain === 1) {
			delete nextRiders[id];
			delete nextNames[id];
		} else {
			nextRiders[id] = gain;
			if (name) nextNames[id] = name;
		}
		riders = nextRiders;
		names = nextNames;
		persist();
	},
	/** Every rider set away from unity (#463), for the profile mixer to reset. */
	get mixedRiders(): { id: string; name: string; gain: number }[] {
		return Object.entries(riders).map(([id, gain]) => ({
			id,
			name: names[id] ?? 'a rider who has left',
			gain,
		}));
	},
};
