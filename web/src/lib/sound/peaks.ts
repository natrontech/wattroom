/**
 * One channel of audio reduced to `buckets` peaks, normalised so the loudest
 * bucket is 1 — the shape a soundboard pad, the trim editor and the jukebox
 * deck all draw (#934, #1425). Normalised for drawing only; a quiet clip
 * whose silhouette was three pixels tall told the rider nothing.
 */
export function peaksOf(samples: Float32Array, buckets: number): number[] {
	const per = Math.max(1, Math.floor(samples.length / buckets));
	const out: number[] = [];
	let loudest = 0;
	for (let b = 0; b < buckets; b++) {
		let peak = 0;
		const from = b * per;
		for (let i = from; i < Math.min(from + per, samples.length); i++) {
			const level = Math.abs(samples[i]);
			if (level > peak) peak = level;
		}
		loudest = Math.max(loudest, peak);
		out.push(peak);
	}
	return loudest > 0 ? out.map((p) => p / loudest) : out;
}
