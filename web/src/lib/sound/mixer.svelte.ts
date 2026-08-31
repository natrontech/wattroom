import { setDuckLevel, setVolume as setCueVolume } from '$lib/sound/cues';

/**
 * The mix has one owner (#179, #152): music, cues, and each rider's voice
 * set here, applied by their outputs. Ducking still happens ON TOP of the
 * music level — the mixer sets the ceiling, the ducker dips under it.
 * Per-device, persisted: a mix is ears, not account state.
 */
const KEY = 'wattroom.mixer.v1';

function load(): {
	music: number;
	cues: number;
	duck: number;
	riders: Record<string, number>;
} {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		return {
			music: clamp(raw.music, 0, 100, 70),
			cues: clamp(raw.cues, 0, 1, 0.7),
			duck: clamp(raw.duck, 0, 1, 0.3),
			riders: typeof raw.riders === 'object' && raw.riders ? raw.riders : {},
		};
	} catch {
		return { music: 70, cues: 0.7, duck: 0.3, riders: {} };
	}
}

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
	return typeof v === 'number' && v >= lo && v <= hi ? v : fallback;
}

let music = $state(70);
let cues = $state(0.7);
let duck = $state(0.3);
let riders = $state<Record<string, number>>({});
const initial = load();
music = initial.music;
cues = initial.cues;
duck = initial.duck;
riders = initial.riders;
setCueVolume(cues);
setDuckLevel(duck);

function persist() {
	try {
		localStorage.setItem(KEY, JSON.stringify({ music, cues, duck, riders }));
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
	/** Per-rider voice gain, 0–2 — above 1 is the "make them louder" ask. */
	riderGain(id: string): number {
		return riders[id] ?? 1;
	},
	setRiderGain(id: string, v: number) {
		riders = { ...riders, [id]: Math.min(2, Math.max(0, v)) };
		persist();
	},
	get riders() {
		return riders;
	},
};
