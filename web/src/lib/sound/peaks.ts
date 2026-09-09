/**
 * One channel of audio reduced to `buckets` peaks, normalised so the loudest
 * bucket is 1 — the shape a soundboard pad, the trim editor and the jukebox
 * deck all draw (#934, #1425). Normalised for drawing only; a quiet clip
 * whose silhouette was three pixels tall told the rider nothing.
 *
 * `reduce` picks what a bucket is worth. `peak` (the loudest sample) suits a
 * pad's second of audio. A whole song is minutes over the same 56 buckets, and
 * a mastered track puts a full-scale sample in every four-second bucket — the
 * deck drew a flat wall rather than a waveform (rider report). `rms` reads the
 * energy of the bucket instead, so the intro, the drop and the outro differ.
 */
export function peaksOf(
	samples: Float32Array,
	buckets: number,
	reduce: 'peak' | 'rms' = 'peak',
): number[] {
	const per = Math.max(1, Math.floor(samples.length / buckets));
	const out: number[] = [];
	let loudest = 0;
	for (let b = 0; b < buckets; b++) {
		const from = b * per;
		const to = Math.min(from + per, samples.length);
		let level = 0;
		if (reduce === 'rms') {
			let energy = 0;
			for (let i = from; i < to; i++) energy += samples[i] * samples[i];
			if (to > from) level = Math.sqrt(energy / (to - from));
		} else {
			for (let i = from; i < to; i++) {
				const sample = Math.abs(samples[i]);
				if (sample > level) level = sample;
			}
		}
		loudest = Math.max(loudest, level);
		out.push(level);
	}
	return loudest > 0 ? out.map((p) => p / loudest) : out;
}
