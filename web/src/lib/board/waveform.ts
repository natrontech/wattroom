/**
 * A pad's face is its own waveform (#877), so a rider finds a sound by
 * silhouette rather than by reading a label at arm's length.
 *
 * ponytail: the shape is derived from the clip's id, not decoded from its
 * audio. It is stable per clip, costs nothing, and needs no decode before a
 * pad can draw — which matters because the board renders before any audio is
 * fetched. Draw the real envelope once the editor decodes clips anyway (#877
 * follow-up); the pad's job until then is to be recognisable, and a shape that
 * never changes for a given clip already is.
 */
export interface Bar {
	x: number;
	y: number;
	h: number;
}

/** Bars across a 104 × 34 box, mirrored about the middle. */
export function waveform(seedText: string, bars: number): Bar[] {
	let seed = 2166136261;
	for (let i = 0; i < seedText.length; i++) {
		seed = Math.imul(seed ^ seedText.charCodeAt(i), 16777619) >>> 0;
	}
	const next = () => {
		seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
		return seed / 4294967296;
	};
	const attack = 0.1 + next() * 0.3;
	const out: Bar[] = [];
	for (let i = 0; i < bars; i++) {
		const t = bars === 1 ? 0 : i / (bars - 1);
		// One shape family: a quick attack, then a decay the seed varies.
		const envelope = t < attack ? t / attack : Math.exp(-2.4 * (t - attack));
		const h = Math.max(2, envelope * (0.55 + 0.45 * next()) * 30);
		out.push({
			x: +(i * (104 / bars)).toFixed(2),
			y: +((34 - h) / 2).toFixed(2),
			h: +h.toFixed(2),
		});
	}
	return out;
}
