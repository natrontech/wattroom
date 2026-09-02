import { setDuckLevel, setVolume as setCueVolume } from '$lib/sound/cues';

/**
 * The mix has one owner (#179, #152): music, cues, and each rider's voice
 * set here, applied by their outputs. Ducking still happens ON TOP of the
 * music level — the mixer sets the ceiling, the ducker dips under it.
 * Per-device, persisted: a mix is ears, not account state.
 */
const KEY = 'wattroom.mixer.v1';

/** A rider's fader, 0–2 — above 1 is the "make them louder" ask (#463). */
const RIDER_GAIN_MAX = 2;

function load(): {
	music: number;
	cues: number;
	duck: number;
	riders: Record<string, number>;
	names: Record<string, string>;
} {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
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
			duck: clamp(raw.duck, 0, 1, 0.3),
			riders,
			names,
		};
	} catch {
		return { music: 70, cues: 0.7, duck: 0.3, riders: {}, names: {} };
	}
}

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
	return typeof v === 'number' && v >= lo && v <= hi ? v : fallback;
}

let music = $state(70);
let cues = $state(0.7);
let duck = $state(0.3);
let riders = $state<Record<string, number>>({});
// Who a stored fader belongs to, so the profile mixer can name a rider who
// is not in the room right now.
let names = $state<Record<string, string>>({});
const initial = load();
music = initial.music;
cues = initial.cues;
duck = initial.duck;
riders = initial.riders;
names = initial.names;
setCueVolume(cues);
setDuckLevel(duck);

function persist() {
	try {
		localStorage.setItem(
			KEY,
			JSON.stringify({ music, cues, duck, riders, names }),
		);
	} catch {
		// ears-only preference; losing it costs one adjustment
	}
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
		setCueVolume(cues);
		persist();
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
