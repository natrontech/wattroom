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
import { SvelteMap } from 'svelte/reactivity';
import { bus } from '$lib/sound/cues';
import { peaksOf } from '$lib/sound/peaks';
import { mixer } from '$lib/sound/mixer.svelte';
import type { Edit } from '$lib/board/clips.svelte';

/**
 * A clip as a LISTENER knows it: the audio, its name, and the edit that says
 * what actually plays. All three come from the server, for everyone's clips
 * including your own — the room must hear one rider's airhorn the same way
 * they do. Reading the trim out of your own library instead meant the firer
 * was the only person who heard their two-second cut; everyone else got the
 * whole uploaded minute, at raw level, called "a sound".
 */
interface Heard extends Edit {
	buffer: AudioBuffer;
	name: string;
}

const decoded = new SvelteMap<string, Heard>();
const loading = new Map<string, Promise<Heard | null>>();

/**
 * What each rider has sounding right now. SPEC's retrigger rule lives here: a
 * rider's new fire stops their previous one, so one rider is at most one
 * voice — without it a 1 s cooldown would bound how often a 60 s clip starts
 * and nothing about how many are playing.
 */
const sounding = new SvelteMap<
	string,
	{ source: AudioBufferSourceNode; gain: GainNode; clipGain: number }
>();

/**
 * Reactive so a tile can wear the mark: who in this room is making a noise
 * right now (#1681). It ends when the audio does, which is why it is this map
 * and not the server's word — the hub holds a fire for the ceiling, not for
 * the clip's real length.
 */
export function isSounding(riderId: string): boolean {
	return sounding.has(riderId);
}

/**
 * Each rider's newest play or stop. A play is still fetching its clip when a
 * stop — or the next play — for the same rider lands; whichever came last
 * wins, so a stop cannot be outrun by the audio it was meant for (#1321).
 *
 * It carries the clip as well as the claim, because "what is this rider
 * already meant to be playing" is the question `catchUp` asks every tick —
 * and asking `sounding` instead would restart a clip still being fetched.
 */
const latest = new Map<string, { token: object; clipId: string }>();

/**
 * What a clip is called, once it has been heard. Reactive, so the strip that
 * names it can be written before the fetch lands. Null while unknown — for
 * everyone's clips including your own, which is what stops the room reading
 * "a sound" for every clip but the one whose owner is looking at the strip.
 */
export function nameOf(clipId: string): string | null {
	return decoded.get(clipId)?.name ?? null;
}

async function load(clipId: string): Promise<Heard | null> {
	const already = decoded.get(clipId);
	if (already) return already;
	const inFlight = loading.get(clipId);
	if (inFlight) return inFlight;

	const audio = bus();
	if (!audio) return null;
	const attempt = (async () => {
		try {
			// Together: the bytes are the slow half and the description is the
			// half a strip needs, and neither is any use without the other.
			const [sound, meta] = await Promise.all([
				fetch(`/api/board/clips/${clipId}/audio`),
				fetch(`/api/board/clips/${clipId}`),
			]);
			if (!sound.ok || !meta.ok) return null;
			const described = (await meta.json()) as Omit<Heard, 'buffer'>;
			const buffer = await audio.ctx.decodeAudioData(await sound.arrayBuffer());
			const heard = { ...described, buffer };
			decoded.set(clipId, heard);
			return heard;
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
export async function fire(clipId: string, riderId: string): Promise<void> {
	// A fire from the room ends whatever the rider was auditioning: one rider
	// is one voice, and the tick outranks a preview.
	if (riderId === auditioning?.riderId) auditioning = null;
	return play(clipId, riderId);
}

/**
 * Start a clip the room is already partway through (#1681): a rider who joins
 * mid-airhorn, whose tick says so on the roster rather than in this second's
 * fires. `sinceMs` is how much of it the room has already heard.
 *
 * A no-op once this machine is already on that rider's clip, so it can be
 * called from every tick — the roster keeps saying so for as long as the hub
 * assumes the clip is running, and the fire that started it arrives first.
 */
export async function catchUp(
	clipId: string,
	riderId: string,
	sinceMs: number,
): Promise<void> {
	if (latest.get(riderId)?.clipId === clipId) return;
	return play(clipId, riderId, undefined, sinceMs);
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

/**
 * Stop everyone this machine is playing who is no longer in the room. Their
 * clip left with them: nothing else will ever stop it, because a stop is a
 * message from a socket that has gone.
 */
export function keepOnly(riderIds: string[]): void {
	const present = new Set(riderIds);
	for (const riderId of [...sounding.keys()]) {
		if (!present.has(riderId)) stop(riderId);
	}
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
	sinceMs = 0,
): Promise<void> {
	const audio = bus();
	if (!audio) return;
	const claim = { token: {}, clipId };
	latest.set(riderId, claim);
	const heard = await load(clipId);
	if (!heard || latest.get(riderId) !== claim) return;

	silence(riderId);
	// The server's edit unless the caller brought one: only the trim face
	// does, auditioning a change it has not saved yet.
	const applied = edit ?? heard;
	const buffer = heard.buffer;
	const start = Math.max(0, applied.startMs / 1000);
	const end = applied.endMs ? applied.endMs / 1000 : buffer.duration;
	const kept = Math.max(0.01, Math.min(buffer.duration, end) - start);
	// How much of it the room has already heard. A clip that finished before
	// this machine got the news is simply not played.
	const into = Math.max(0, sinceMs / 1000);
	if (into >= kept) return;
	const left = kept - into;
	const gain = audio.ctx.createGain();
	// The clip's own gain multiplies the rider's level rather than replacing
	// it, so a fader move later still scales what the editor asked for.
	const clipGain = Math.pow(10, applied.gainDb / 20);
	const peak = levelFor(riderId) * clipGain;
	const now = audio.ctx.currentTime;
	const fadeIn = Math.min(applied.fadeInMs / 1000, kept / 2);
	const fadeOut = Math.min(applied.fadeOutMs / 1000, kept / 2);
	// ponytail: joining mid-clip skips the fade-in rather than entering it
	// part-way. The room is already past the attack — a second ramp from
	// silence would be a fade nobody else heard.
	if (fadeIn > 0 && into === 0) {
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(peak, now + fadeIn);
	} else {
		gain.gain.setValueAtTime(peak, now);
	}
	if (fadeOut > 0 && left > fadeOut) {
		gain.gain.setValueAtTime(peak, now + left - fadeOut);
		gain.gain.linearRampToValueAtTime(0, now + left);
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
	source.start(now, start + into, left);
}

/**
 * Stop what one rider has sounding, or is about to: the retrigger rule, a
 * stop from the tick (#1321), and leaving a room.
 */
export function stop(riderId: string): void {
	latest.set(riderId, { token: {}, clipId: '' });
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
	const heard = await load(clipId);
	if (!heard) return null;
	return peaksOf(heard.buffer.getChannelData(0), buckets);
}
