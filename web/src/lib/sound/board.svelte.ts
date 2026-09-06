/**
 * Soundboard playback (#877, ADR-0033). A fire arrives on the tick carrying a
 * clip id; every listener fetches the audio themselves and mixes it locally,
 * which is the only place a listener's own fader can possibly work.
 *
 * Not the cue engine: cues are synthesised parameter sets that never travel,
 * and they ride the cues fader. This rides the board fader and shares only the
 * limiter (`bus()`), so an airhorn and a klaxon in the same second are squashed
 * together rather than clipping.
 */
import { bus } from '$lib/sound/cues';
import { mixer } from '$lib/sound/mixer.svelte';
import type { Edit } from '$lib/board/clips.svelte';

const decoded = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();

/**
 * What each rider has sounding right now. SPEC's retrigger rule lives here: a
 * rider's new fire stops their previous one, so one rider is at most one
 * voice — without it a 1 s cooldown would bound how often a 60 s clip starts
 * and nothing about how many are playing.
 */
const sounding = new Map<
	string,
	{ source: AudioBufferSourceNode; gain: GainNode; clipGain: number }
>();

function clipUrl(clipId: string): string {
	return `/api/board/clips/${clipId}/audio`;
}

async function load(clipId: string): Promise<AudioBuffer | null> {
	const already = decoded.get(clipId);
	if (already) return already;
	const inFlight = loading.get(clipId);
	if (inFlight) return inFlight;

	const audio = bus();
	if (!audio) return null;
	const attempt = (async () => {
		try {
			const res = await fetch(clipUrl(clipId));
			if (!res.ok) return null;
			const buffer = await audio.ctx.decodeAudioData(await res.arrayBuffer());
			decoded.set(clipId, buffer);
			return buffer;
		} catch {
			// A clip that will not load is a clip that makes no sound. The
			// pad says nothing: there is no recovery a rider mid-ride could
			// perform, and a toast over the ride would be worse than silence.
			return null;
		} finally {
			loading.delete(clipId);
		}
	})();
	loading.set(clipId, attempt);
	return attempt;
}

/** What one rider's clip should sound at on THIS machine, right now. */
function levelFor(riderId: string): number {
	if (mixer.muted) return 0;
	return mixer.board * mixer.riderGain(riderId);
}

/**
 * Warm a rider's clips so the first press is not late. Fire-and-forget: a
 * failed prefetch costs one slow first play, never an error.
 */
export function prefetch(clipIds: string[]): void {
	for (const id of clipIds) void load(id);
}

/**
 * Play one rider's clip, replacing whatever else that rider had sounding.
 *
 * The edit (#934) is applied HERE rather than baked into the audio: the source
 * is whatever was uploaded, and trim, gain and fades are three arguments and
 * two ramps. Nothing is re-encoded, so an edit stays undoable forever and
 * costs no second copy of the file.
 */
export async function fire(
	clipId: string,
	riderId: string,
	edit?: Edit,
): Promise<void> {
	const audio = bus();
	if (!audio) return;
	const buffer = await load(clipId);
	if (!buffer) return;

	stop(riderId);
	const start = Math.max(0, (edit?.startMs ?? 0) / 1000);
	const end = edit?.endMs ? edit.endMs / 1000 : buffer.duration;
	const kept = Math.max(0.01, Math.min(buffer.duration, end) - start);
	const gain = audio.ctx.createGain();
	// The clip's own gain multiplies the rider's level rather than replacing
	// it, so a fader move later still scales what the editor asked for.
	const clipGain = Math.pow(10, (edit?.gainDb ?? 0) / 20);
	const peak = levelFor(riderId) * clipGain;
	const now = audio.ctx.currentTime;
	const fadeIn = Math.min((edit?.fadeInMs ?? 0) / 1000, kept / 2);
	const fadeOut = Math.min((edit?.fadeOutMs ?? 0) / 1000, kept / 2);
	if (fadeIn > 0) {
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(peak, now + fadeIn);
	} else {
		gain.gain.setValueAtTime(peak, now);
	}
	if (fadeOut > 0) {
		gain.gain.setValueAtTime(peak, now + kept - fadeOut);
		gain.gain.linearRampToValueAtTime(0, now + kept);
	}
	gain.connect(audio.input);
	const source = audio.ctx.createBufferSource();
	source.buffer = buffer;
	source.connect(gain);
	source.onended = () => {
		if (sounding.get(riderId)?.source === source) sounding.delete(riderId);
		gain.disconnect();
	};
	sounding.set(riderId, { source, gain, clipGain });
	source.start(now, start, kept);
}

/** Stop what one rider has sounding — the retrigger rule, and leaving a room. */
export function stop(riderId: string): void {
	const live = sounding.get(riderId);
	if (!live) return;
	sounding.delete(riderId);
	try {
		live.source.stop();
	} catch {
		// Already ended between the check and here; onended did the cleanup.
	}
}

export function stopAll(): void {
	for (const riderId of [...sounding.keys()]) stop(riderId);
}

/**
 * Re-aim what is already playing. A fader moved during a 60 s clip has to move
 * that clip, not just the next one.
 */
export function applyLevels(): void {
	const audio = bus();
	if (!audio) return;
	for (const [riderId, live] of sounding) {
		live.gain.gain.setTargetAtTime(
			levelFor(riderId),
			audio.ctx.currentTime,
			0.02,
		);
	}
}

/** Test seam: the caches are module-level, so a test needs a way to reset. */
export function forget(): void {
	stopAll();
	decoded.clear();
	loading.clear();
}

/**
 * The clip's real envelope, reduced to `buckets` peaks — what the editor draws
 * and what a pad can draw once a clip has been decoded (#934). Null while the
 * audio is unavailable, so a caller falls back to the id-derived shape.
 */
export async function peaks(
	clipId: string,
	buckets: number,
): Promise<number[] | null> {
	const buffer = await load(clipId);
	if (!buffer) return null;
	const samples = buffer.getChannelData(0);
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
	// Normalised for drawing only — the audio is untouched. A quiet clip whose
	// shape was three pixels tall told the rider nothing.
	return loudest > 0 ? out.map((p) => p / loudest) : out;
}
