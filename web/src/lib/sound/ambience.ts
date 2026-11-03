import { Biome } from '$lib/world/biome';
import type { NoiseVoice, Voice } from '$lib/sound/cue-catalogue';
import { makeNoise, scheduleVoices } from '$lib/sound/cue-graph';
import { cueInput } from '$lib/sound/cues';
import { glideTo } from '$lib/sound/glide';

/**
 * The ride's ambience (#3186): the land beside the road and the air you ride
 * through, synthesised like the cues, played into the cue master so the cue
 * fader and the duck under a voice carry it — no mixer channel of its own.
 * Every number is docs/spec/world.md "The living world" (defaults — tune in
 * alpha).
 */
export const AMBIENCE = {
	voices: 6,
	oneShotsPerMin: 8,
	underMusicDb: -12,
	bedDb: -24,
	fadeMs: 2000,
	besideM: 25,
	windFullKmh: 50,
	movingMps: 0.5,
	cowbellS: [10, 30],
	pastureM: 1300,
	villageM: 150,
} as const;

export type Bed = 'wind' | 'forest' | 'meadow' | 'stream' | 'alpine';

const BED_OF: Partial<Record<Biome, Bed>> = {
	[Biome.Forest]: 'forest',
	[Biome.Meadow]: 'meadow',
	[Biome.Water]: 'stream',
	[Biome.Alpine]: 'alpine',
	[Biome.Rock]: 'alpine',
	[Biome.Snow]: 'alpine',
};

export const fromDb = (db: number) => 10 ** (db / 20);

/** Where each bed sits at this speed, with this land either side of the road. */
export function bedLevels(
	mps: number,
	beside: readonly (Biome | null)[],
): Record<Bed, number> {
	const top = fromDb(AMBIENCE.bedDb);
	const kmh = Math.max(0, mps) * 3.6;
	const levels: Record<Bed, number> = {
		// #4368's in-the-wheel drop (docs/spec/races.md "Drafting": −4 dB, its
		// band × 0.8 at ≥ 20 % shelter) lands on this gain and on WIND's band.
		wind: top * Math.min(1, kmh / AMBIENCE.windFullKmh) ** 2,
		forest: 0,
		meadow: 0,
		stream: 0,
		alpine: 0,
	};
	for (const b of beside) {
		const bed = b == null ? undefined : BED_OF[b];
		if (bed) levels[bed] += top / beside.length;
	}
	return levels;
}

/** The ambience's level against the cue master: 12 dB down while the jukebox plays. */
export const busLevel = (music: boolean) =>
	music ? fromDb(AMBIENCE.underMusicDb) : 1;

/**
 * Whether a one-shot may sound now: at most 8 started in any minute, and the
 * beds sounding plus every voice still ringing at most 6. `now` in seconds.
 */
export function createGate() {
	let started: number[] = [];
	let ringing: { until: number; voices: number }[] = [];
	return (now: number, beds: number, shot: readonly Envelope[]): boolean => {
		started = started.filter((t) => now - t < 60);
		ringing = ringing.filter((r) => r.until > now);
		const busy = beds + ringing.reduce((n, r) => n + r.voices, 0);
		if (started.length >= AMBIENCE.oneShotsPerMin) return false;
		if (busy + shot.length > AMBIENCE.voices) return false;
		started.push(now);
		ringing.push({
			until: now + Math.max(...shot.map((v) => v.at + v.dur)),
			voices: shot.length,
		});
		return true;
	};
}

type Envelope = Voice | NoiseVoice;

/** What a bed is: white noise through one filter, swelling at `swell` Hz by `depth`. */
const BEDS: Record<
	Bed,
	{
		type: BiquadFilterType;
		freq: number;
		q: number;
		swell: number;
		depth: number;
	}
> = {
	// Air past the ears: its band climbs with speed (WIND_BAND).
	wind: { type: 'bandpass', freq: 300, q: 0.7, swell: 0.2, depth: 0.25 },
	// Leaves: a low rustle that comes and goes.
	forest: { type: 'lowpass', freq: 700, q: 0.7, swell: 0.15, depth: 0.4 },
	// Crickets: a high, narrow trill.
	meadow: { type: 'bandpass', freq: 5200, q: 6, swell: 7, depth: 0.5 },
	// Water over stones: broad and babbling.
	stream: { type: 'bandpass', freq: 1800, q: 0.8, swell: 0.9, depth: 0.3 },
	// High, open air: slow gusts.
	alpine: { type: 'bandpass', freq: 450, q: 0.5, swell: 0.08, depth: 0.6 },
};
/** The wind's band, standing to full speed. */
const WIND_BAND = [300, 1200] as const;

/** The one-shots: softer and lower than the cue catalogue's, so a cowbell on the pasture never reads as one rung for you. */
const SHOTS = {
	cowbells: [
		{
			type: 'square',
			freq: 380,
			at: 0,
			dur: 0.45,
			gain: 0.1,
			filter: { from: 620, q: 3, type: 'bandpass' },
		},
		{
			type: 'square',
			freq: 560,
			at: 0.22,
			dur: 0.4,
			gain: 0.08,
			filter: { from: 620, q: 3, type: 'bandpass' },
		},
	],
	// One toll, a bell's hum, its minor third and its fifth above, dying slow.
	church: [
		{ type: 'sine', freq: 330, at: 0, dur: 2.8, gain: 0.1 },
		{ type: 'sine', freq: 792, at: 0, dur: 1.8, gain: 0.05 },
		{ type: 'sine', freq: 990, at: 0, dur: 2.2, gain: 0.04 },
	],
	// The pawls on the ratchet as the legs stop.
	freewheel: [0, 0.07, 0.14].map((at): NoiseVoice => ({
		type: 'noise',
		at,
		dur: 0.012,
		gain: 0.12,
		filter: { from: 4200, q: 2, type: 'bandpass' },
	})),
} satisfies Record<string, Envelope[]>;

/** What the ride tells the ambience, a few times a second. */
export type Heard = {
	/** The count-in is running. */
	counting: boolean;
	mps: number;
	/** The land 25 m either side of the road. */
	beside: readonly (Biome | null)[];
	/** The road's height under you, m. */
	ele: number;
	/** Your power; null while the trainer is silent. */
	watts: number | null;
	/** The village you are passing (its metre along the road), or null. */
	village: number | null;
};

type Graph = {
	ctx: AudioContext;
	bus: GainNode;
	levels: Record<Bed, GainNode>;
	windBand: BiquadFilterNode;
	sources: AudioScheduledSourceNode[];
	noise: AudioBuffer;
};

let graph: Graph | null = null;
let music = false;
let started = false;
let gate = createGate();
let coasting = false;
let village: number | null = null;
let cowbellAt = 0;

function build(): Graph | null {
	const cue = cueInput();
	if (!cue) return null;
	const { ctx } = cue;
	const noise = makeNoise(ctx);
	const bus = ctx.createGain();
	bus.gain.value = busLevel(music);
	bus.connect(cue.input);
	const sources: AudioScheduledSourceNode[] = [];
	const levels = {} as Record<Bed, GainNode>;
	let windBand: BiquadFilterNode | null = null;
	for (const [bed, b] of Object.entries(BEDS) as [Bed, (typeof BEDS)[Bed]][]) {
		const src = ctx.createBufferSource();
		src.buffer = noise;
		src.loop = true;
		const filter = ctx.createBiquadFilter();
		filter.type = b.type;
		filter.frequency.value = b.freq;
		filter.Q.value = b.q;
		// The swell rides the gain between 1 − 2·depth and 1.
		const swell = ctx.createGain();
		swell.gain.value = 1 - b.depth;
		const lfo = ctx.createOscillator();
		lfo.frequency.value = b.swell;
		const depth = ctx.createGain();
		depth.gain.value = b.depth;
		lfo.connect(depth);
		depth.connect(swell.gain);
		const level = ctx.createGain();
		level.gain.value = 0;
		src.connect(filter);
		filter.connect(swell);
		swell.connect(level);
		level.connect(bus);
		src.start();
		lfo.start();
		sources.push(src, lfo);
		levels[bed] = level;
		if (bed === 'wind') windBand = filter;
	}
	return { ctx, bus, levels, windBand: windBand!, sources, noise };
}

function shot(g: Graph, voices: readonly Envelope[], beds: number): void {
	const now = g.ctx.currentTime;
	if (!gate(now, beds, voices)) return;
	scheduleVoices(g.ctx, g.bus, voices, now + 0.01, 1, () => g.noise);
}

export const ambience = {
	/** The ride's moment: builds the beds once the ride has started, then follows it. */
	hear(h: Heard): void {
		if (!started) {
			if (h.counting || h.mps <= AMBIENCE.movingMps) return;
			started = true;
		}
		graph ??= build();
		const g = graph;
		if (!g) return;
		const now = g.ctx.currentTime;
		const levels = bedLevels(h.mps, h.beside);
		let beds = 0;
		for (const bed of Object.keys(levels) as Bed[]) {
			glideTo(g.levels[bed].gain, levels[bed], now, AMBIENCE.fadeMs);
			if (levels[bed] > 0) beds++;
		}
		const speed = Math.min(
			1,
			(Math.max(0, h.mps) * 3.6) / AMBIENCE.windFullKmh,
		);
		glideTo(
			g.windBand.frequency,
			WIND_BAND[0] + (WIND_BAND[1] - WIND_BAND[0]) * speed,
			now,
			AMBIENCE.fadeMs,
		);

		const moving = h.mps > AMBIENCE.movingMps;
		const coast = moving && h.watts === 0;
		if (coast && !coasting) shot(g, SHOTS.freewheel, beds);
		coasting = coast;

		if (h.village !== null && h.village !== village)
			shot(g, SHOTS.church, beds);
		village = h.village;

		const pasture = h.beside.some(
			(b) =>
				b === Biome.Alpine || (b === Biome.Meadow && h.ele > AMBIENCE.pastureM),
		);
		if (!pasture) cowbellAt = 0;
		else if (!cowbellAt) cowbellAt = now + nextCowbell();
		else if (now >= cowbellAt) {
			shot(g, SHOTS.cowbells, beds);
			cowbellAt = now + nextCowbell();
		}
	},
	/** The world closed: the beds fade out and the graph goes. */
	stop(): void {
		const g = graph;
		graph = null;
		started = coasting = false;
		village = null;
		cowbellAt = 0;
		gate = createGate();
		if (!g) return;
		const end = g.ctx.currentTime + AMBIENCE.fadeMs / 1000;
		glideTo(g.bus.gain, 0, g.ctx.currentTime, AMBIENCE.fadeMs);
		for (const s of g.sources) s.stop(end);
		g.sources[0].onended = () => g.bus.disconnect();
	},
};

const nextCowbell = () =>
	AMBIENCE.cowbellS[0] +
	Math.random() * (AMBIENCE.cowbellS[1] - AMBIENCE.cowbellS[0]);

/** The jukebox is playing to this rider: the ambience steps 12 dB down under it. */
export function setMusic(on: boolean): void {
	music = on;
	if (graph)
		glideTo(
			graph.bus.gain,
			busLevel(music),
			graph.ctx.currentTime,
			AMBIENCE.fadeMs,
		);
}
