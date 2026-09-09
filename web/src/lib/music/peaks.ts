/**
 * A library track's waveform (#1425): the file fetched once more — the
 * browser's cache has it from the deck — decoded off the audio thread, and
 * reduced to `buckets` peaks. Remembered per track for the session, so the
 * deck does not decode again when the room comes back to a song. Null when
 * the file cannot be read; the deck then keeps its placeholder shape.
 */
import { audioSrc } from '$lib/music/pool';
import { peaksOf } from '$lib/sound/peaks';

const known = new Map<string, Promise<number[] | null>>();

export function trackPeaks(
	trackId: string,
	buckets: number,
): Promise<number[] | null> {
	const key = `${trackId}:${buckets}`;
	const already = known.get(key);
	if (already) return already;
	const attempt = (async () => {
		try {
			const res = await fetch(audioSrc(trackId));
			if (!res.ok) return null;
			// An offline context decodes without a user gesture and without
			// touching the mixer's own context.
			const ctx = new OfflineAudioContext(1, 1, 44100);
			const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
			return peaksOf(buffer.getChannelData(0), buckets, 'rms');
		} catch {
			return null;
		}
	})();
	known.set(key, attempt);
	void attempt.then((p) => {
		if (!p) known.delete(key);
	});
	return attempt;
}
