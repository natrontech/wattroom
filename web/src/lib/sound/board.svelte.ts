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

/**
 * Each rider's newest play or stop. A play is still fetching its clip when a
 * stop — or the next play — for the same rider lands; whichever came last
 * wins, so a stop cannot be outrun by the audio it was meant for (#1321).
 */
const latest = new Map<string, object>();

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
	// A fire from the room ends whatever the rider was auditioning: one rider
	// is one voice, and the tick outranks a preview.
	if (riderId === auditioning?.riderId) auditioning = null;
	return play(clipId, riderId, edit);
}

/**
 * Play a clip to THIS machine only (#981): no `onFire`, no protocol message,
 * no tick entry, and nothing the "someone fired X" strip reports. It is the
 * same `play` a fire uses, with the local rider's own id, so the retrigger
 * rule and the board fader keep working — an audition is a fire that never
 * went to the hub, not a second audio path.
 *
 * `loop` is the trim face: restarting at the boundary rather than looping the
 * buffer, so every pass applies the fades the rider is actually setting.
 */
export async function preview(
	clipId: string,
	riderId: string,
	edit?: Edit,
	loop = false,
): Promise<void> {
	const token = {};
	auditioning = { clipId, riderId, edit, loop, token };
	return play(clipId, riderId, edit);
}

/** What this machine is auditioning, for the button that says so. */
export function previewing(): string | null {
	return auditioning?.clipId ?? null;
}

/**
 * How far into the kept range the audition is, in seconds — null when nothing
 * is being auditioned. Read every frame by the trim face's playhead, so it is
 * a plain computation off the audio clock rather than state that ticks.
 */
export function previewAt(): number | null {
	const live = auditioning;
	const audio = bus();
	if (!live || !audio || live.startedAt === undefined || !live.kept)
		return null;
	const into = audio.ctx.currentTime - live.startedAt;
	if (into < 0) return 0;
	return live.loop ? into % live.kept : Math.min(into, live.kept);
}

/** Stop an audition; a no-op when nothing is being auditioned. */
export function stopPreview(): void {
	const was = auditioning;
	auditioning = null;
	if (was) stop(was.riderId);
}

// Reactive: the row's play button and the trim face's readout both draw from
// it, and it flips when the audio starts and when it is stopped or taken over.
let auditioning = $state<{
	clipId: string;
	riderId: string;
	edit?: Edit;
	loop: boolean;
	token: object;
	/** Context time this pass started, and how much of the clip it plays. */
	startedAt?: number;
	kept?: number;
} | null>(null);

async function play(
	clipId: string,
	riderId: string,
	edit?: Edit,
): Promise<void> {
	const audio = bus();
	if (!audio) return;
	const claim = {};
	latest.set(riderId, claim);
	const buffer = await load(clipId);
	if (!buffer || latest.get(riderId) !== claim) return;

	silence(riderId);
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
	// Only this rider's own audition of this clip is the loop's to restart:
	// pinning whatever was being auditioned to another rider's clip made
	// their fire ending start this rider's loop over from the top.
	const mine =
		auditioning?.clipId === clipId && auditioning.riderId === riderId
			? auditioning
			: null;
	source.onended = () => {
		if (sounding.get(riderId)?.source === source) sounding.delete(riderId);
		gain.disconnect();
		// The loop, restarted rather than looped: `mine` pins the audition this
		// pass belonged to, so stopping it — or firing over it — ends the loop
		// instead of racing a fresh one.
		if (mine && mine.loop && auditioning?.token === mine.token) {
			void play(mine.clipId, mine.riderId, mine.edit);
		}
	};
	sounding.set(riderId, { source, gain, clipGain });
	// Where the playhead is, for the face that draws one. Written here because
	// this is the only place that knows when the audio actually started.
	if (mine) {
		mine.startedAt = now;
		mine.kept = kept;
	}
	source.start(now, start, kept);
}

/**
 * Stop what one rider has sounding, or is about to: the retrigger rule, a
 * stop from the tick (#1321), and leaving a room.
 */
export function stop(riderId: string): void {
	latest.set(riderId, {});
	silence(riderId);
}

function silence(riderId: string): void {
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
	auditioning = null;
	for (const riderId of [...latest.keys()]) stop(riderId);
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
	latest.clear();
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
