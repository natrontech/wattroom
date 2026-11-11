// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Biome } from '#lib/world/biome.ts';
import { DUCK_DEFAULT } from '#lib/sound/ducking.ts';
import {
	AMBIENCE,
	bedLevels,
	busLevel,
	createGate,
	fromDb,
} from '#lib/sound/ambience.ts';

const top = fromDb(AMBIENCE.bedDb);
const kmh = (v: number) => v / 3.6;

describe('the beds (#3186)', () => {
	it('keeps the wind silent standing and full from 50 km/h', () => {
		expect(bedLevels(0, []).wind).toBe(0);
		expect(bedLevels(kmh(25), []).wind).toBeCloseTo(top / 4);
		expect(bedLevels(kmh(50), []).wind).toBeCloseTo(top);
		expect(bedLevels(kmh(80), []).wind).toBeCloseTo(top);
	});

	it('gives each side of the road half a bed of what grows there', () => {
		const forest = bedLevels(0, [Biome.Forest, Biome.Meadow]);
		expect(forest.forest).toBeCloseTo(top / 2);
		expect(forest.meadow).toBeCloseTo(top / 2);
		expect(bedLevels(0, [Biome.Forest, Biome.Forest]).forest).toBeCloseTo(top);
		expect(bedLevels(0, [Biome.Rock, Biome.Snow]).alpine).toBeCloseTo(top);
		expect(bedLevels(0, [Biome.Water, null]).stream).toBeCloseTo(top / 2);
	});

	it('hears nothing of a verge or of ground not drawn', () => {
		const none = bedLevels(0, [Biome.Verge, null]);
		expect(Object.values(none).every((v) => v === 0)).toBe(true);
	});

	it('sits 12 dB under music', () => {
		expect(busLevel(false)).toBe(1);
		expect(20 * Math.log10(busLevel(true))).toBeCloseTo(-12);
	});
});

const voices = (n: number, dur = 1) =>
	Array.from({ length: n }, () => ({
		type: 'sine' as const,
		freq: 440,
		at: 0,
		dur,
	}));

describe('the one-shot gate (#3186)', () => {
	it('never lets more than six voices sound, beds included', () => {
		const gate = createGate();
		expect(gate(0, 3, voices(3))).toBe(true);
		// Still ringing: three beds and three voices are the six.
		expect(gate(0.5, 3, voices(1))).toBe(false);
		expect(gate(1.5, 3, voices(3))).toBe(true);
		expect(gate(3, 4, voices(3))).toBe(false);
	});

	it('starts at most eight a minute', () => {
		const gate = createGate();
		for (let i = 0; i < 8; i++)
			expect(gate(i * 2, 0, voices(1, 0.1))).toBe(true);
		expect(gate(30, 0, voices(1, 0.1))).toBe(false);
		expect(gate(60, 0, voices(1, 0.1))).toBe(true);
	});
});

/** Enough of an AudioContext to see where the ambience is wired and what its gains are told. */
type Node = {
	to: Node[];
	gain: { value: number; targets: number[] };
	[k: string]: unknown;
};
const gains: Node[] = [];
let now = 0;

function param() {
	const p = {
		value: 0,
		targets: [] as number[],
		setValueAtTime: (v: number) => void p.targets.push(v),
		setTargetAtTime: (v: number) => void p.targets.push(v),
		exponentialRampToValueAtTime: () => {},
	};
	return p;
}

function node(): Node {
	const n: Node = {
		to: [],
		connect: (other: Node) => void n.to.push(other),
		disconnect: () => {},
		start: () => {},
		stop: () => {},
		gain: param(),
		frequency: param(),
		detune: param(),
		Q: param(),
		threshold: param(),
		knee: param(),
		ratio: param(),
		attack: param(),
		release: param(),
		pan: param(),
	};
	return n;
}

class FakeAudioContext {
	state = 'running';
	destination = node();
	get currentTime() {
		return now;
	}
	createGain = () => {
		const g = node();
		gains.push(g);
		return g;
	};
	createDynamicsCompressor = node;
	createOscillator = node;
	createBiquadFilter = node;
	createStereoPanner = node;
	createBufferSource = node;
	sampleRate = 8;
	createBuffer = () => ({ getChannelData: () => new Float32Array(8) });
	resume = async () => {};
}

const moving = {
	counting: false,
	mps: kmh(30),
	beside: [Biome.Forest, Biome.Meadow],
	ele: 600,
	watts: 200,
	village: null,
};

async function fresh() {
	vi.resetModules();
	const ambience = await import('./ambience');
	const duck = await import('./duck');
	return { ...ambience, setDucking: duck.setDucking };
}

describe('the ambience on the cues bus (#3186)', () => {
	beforeEach(() => {
		vi.stubGlobal('AudioContext', FakeAudioContext);
		vi.useFakeTimers();
		gains.length = 0;
		now = 5;
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('makes no sound before the ride has started', async () => {
		const { ambience } = await fresh();
		ambience.hear({ ...moving, counting: true });
		ambience.hear({ ...moving, mps: 0 });
		expect(gains).toEqual([]);
	});

	it('plays into the cue master, so it ducks under a voice with the cues', async () => {
		const { ambience, setDucking } = await fresh();
		ambience.hear(moving);
		// The cue master is the first gain the cue bus makes.
		const master = gains[0];
		const bus = gains.find((g) => g.to.includes(master));
		expect(bus).toBeDefined();
		master.gain.targets.length = 0;
		setDucking(true);
		expect(master.gain.targets.at(-1)).toBeCloseTo(0.7 * DUCK_DEFAULT);
	});

	it('steps 12 dB down while music plays, and back', async () => {
		const { ambience, setMusic } = await fresh();
		ambience.hear(moving);
		const bus = gains.find((g) => g.to.includes(gains[0]))!;
		setMusic(true);
		expect(bus.gain.targets.at(-1)).toBeCloseTo(fromDb(-12));
		setMusic(false);
		expect(bus.gain.targets.at(-1)).toBe(1);
	});

	it('ticks once as the legs stop, and not again until they turn', async () => {
		const { ambience } = await fresh();
		ambience.hear(moving);
		const before = gains.length;
		ambience.hear({ ...moving, watts: 0 });
		const ticked = gains.length - before;
		expect(ticked).toBe(3); // the ratchet's three pawls
		now += 1;
		ambience.hear({ ...moving, watts: 0 });
		expect(gains.length - before).toBe(ticked);
	});
});
