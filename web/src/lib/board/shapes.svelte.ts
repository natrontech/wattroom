/**
 * What a pad draws (#877). The audio is already decoded for playback, so the
 * real envelope costs one reduction — this remembers it per clip and hands the
 * id-derived shape back until it arrives.
 *
 * Two shapes rather than one because they answer at different times: a pad
 * renders the instant the library loads, and the audio may still be in flight.
 * A pad that drew nothing until then would flicker into existence mid-ride.
 */
import { peaks } from '$lib/sound/board.svelte';
import { waveform, type Bar } from '$lib/board/waveform';

const BOX_W = 104;
const BOX_H = 34;

let decoded = $state<Record<string, number[]>>({});
const asked = new Set<string>();

/** Reduce a clip's audio to `bars` peaks, once, in the background. */
export function learn(clipId: string, bars: number): void {
	if (asked.has(clipId)) return;
	asked.add(clipId);
	void peaks(clipId, bars).then((real) => {
		if (real) decoded = { ...decoded, [clipId]: real };
	});
}

/**
 * The bars to draw: the clip's own envelope where it is known, the shape
 * derived from its id where it is not. Both fill the same box, so a pad does
 * not resize when the real one lands.
 */
export function shapeOf(clipId: string, bars: number): Bar[] {
	const real = decoded[clipId];
	if (!real) return waveform(clipId, bars);
	return real.map((level, i) => {
		const h = Math.max(2, level * (BOX_H - 4));
		return {
			x: +((i * BOX_W) / real.length).toFixed(2),
			y: +((BOX_H - h) / 2).toFixed(2),
			h: +h.toFixed(2),
		};
	});
}
