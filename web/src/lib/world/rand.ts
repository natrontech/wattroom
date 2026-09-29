// Seeded randomness: every client that loads the same route draws the same world.

export function hashSeed(s: string): number {
	let h = 1779033703 ^ s.length;
	for (let i = 0; i < s.length; i++) {
		h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	return (h ^ (h >>> 16)) >>> 0;
}

export function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export type Noise2 = (x: number, z: number) => number;

// ponytail: 2D value noise with smoothstep, not simplex — fbm hides the grid;
// `simplex-noise` if the terrain ever reads blocky.
export function noise2(seed: number): Noise2 {
	const r = prng(seed);
	const perm = new Uint8Array(512);
	const vals = new Float32Array(256);
	for (let i = 0; i < 256; i++) {
		perm[i] = i;
		vals[i] = r() * 2 - 1;
	}
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(r() * (i + 1));
		[perm[i], perm[j]] = [perm[j], perm[i]];
	}
	for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
	const v = (x: number, z: number) => vals[perm[(x & 255) + perm[z & 255]]];
	const s = (t: number) => t * t * (3 - 2 * t);
	return (x, z) => {
		const xi = Math.floor(x);
		const zi = Math.floor(z);
		const tx = s(x - xi);
		const tz = s(z - zi);
		const a = v(xi, zi) + (v(xi + 1, zi) - v(xi, zi)) * tx;
		const b = v(xi, zi + 1) + (v(xi + 1, zi + 1) - v(xi, zi + 1)) * tx;
		return a + (b - a) * tz;
	};
}

export function fbm(n: Noise2, x: number, z: number, oct: number): number {
	let sum = 0;
	let amp = 1;
	let f = 1;
	let norm = 0;
	for (let o = 0; o < oct; o++) {
		sum += n(x * f, z * f) * amp;
		norm += amp;
		amp *= 0.5;
		f *= 2.03;
	}
	return sum / norm;
}

export const smoothstep = (a: number, b: number, t: number): number => {
	const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
	return k * k * (3 - 2 * k);
};
