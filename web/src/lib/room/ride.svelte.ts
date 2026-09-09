import { arbitrate } from '$lib/ble/arbitrate';
import { createPersonalGuards, type GuardPhase } from '$lib/workout/guards';
import { serverNow } from '$lib/room/server-clock';
import type { Trainer, TrainerStatus } from '$lib/ble/trainer';
import { sensors } from '$lib/sensors.svelte';
import { wireMetrics } from '$lib/room/wire';
import { targetAt } from '$lib/workout/engine';
import type { Segment } from '$lib/workout/types';
import type { GameState, SprintState } from '$lib/protocol';
import type { createRecording } from '$lib/room/recording.svelte';

interface RideDeps {
	/** The room socket: metrics go out on it, targets and ticks come off it. */
	live: {
		sendMetrics(payload: ReturnType<typeof wireMetrics>): void;
		finish(): void;
		readonly tick:
			| { at?: number; game?: GameState; sprint?: SprintState }
			| null
			| undefined;
	};
	profile: {
		readonly current: {
			ftp: number;
			shareHr: boolean;
			singleSpeed: boolean;
			sprintGrade: number;
		};
	};
	recording: ReturnType<typeof createRecording>;
	myId: () => string | undefined;
	shared: () => { phase: string; elapsed: number } | undefined;
	segments: () => Segment[];
}

/**
 * Riding along: the trainer, the target it holds, the trim on it, and the
 * sprint that lets go of it. Lifted out of RoomShell so the shell composes
 * rather than owns (code-quality.md's ceiling); behaviour unchanged.
 *
 * Called during component init — the $derived and $effect inside need the
 * component's effect context.
 */
export function createRide(deps: RideDeps) {
	let trainer = $state<Trainer | null>(null);
	let error = $state<string | null>(null);
	let hrSource = $state<'heart-rate' | 'trainer' | null>(null);
	let status = $state<TrainerStatus>('disconnected');
	let lastSampleAt = $state(0);
	let unsubscribe: (() => void)[] = [];

	/**
	 * What the trainer is actually doing (#520). "Paired" used to be the only
	 * state the room could show, so a trainer that dropped, that reattached in
	 * a loop, or that delivered not one watt all read as working.
	 *
	 * Silence is judged against the wall clock; the tick is read purely to
	 * re-run this once a second, since a sample that never arrives cannot
	 * invalidate anything by itself.
	 */
	const fault = $derived.by((): 'reconnecting' | 'silent' | null => {
		if (!trainer) return null;
		if (status !== 'connected') return 'reconnecting';
		void deps.live.tick?.at;
		// Counted from the connect, not the first sample: a trainer that never
		// sends one is the reported failure, and exempting it would hide it.
		return Date.now() - lastSampleAt > 10_000 ? 'silent' : null;
	});

	// Bias is personal: ±% on my own targets, the shared timeline untouched.
	let bias = $state(1);
	function nudgeBias(step: number) {
		bias = Math.min(1.2, Math.max(0.8, Math.round((bias + step) * 100) / 100));
	}

	/** What the room asks of this rider, before their own guards get a say. */
	const prescribed = $derived.by(() => {
		const game = deps.live.tick?.game;
		const mine = game?.riders?.[deps.myId() ?? ''];
		if (game?.phase === 'running' && mine && mine.targetPct) {
			return Math.round(mine.targetPct * deps.profile.current.ftp);
		}
		const shared = deps.shared();
		const segments = deps.segments();
		if (!shared || shared.phase !== 'running' || segments.length === 0)
			return 0;
		const raw =
			targetAt(segments, deps.profile.current.ftp, shared.elapsed)
				.targetWatts ?? 0;
		return Math.round(raw * bias);
	});

	/**
	 * Auto-pause and the spiral release, the same machine the solo ride runs
	 * (#788). A rider who stops, or who grinds to a halt at 40 rpm, gets their
	 * target released in a room exactly as they would alone — and the room's
	 * clock does not notice, because the guards mask this rider's target and
	 * touch nothing shared.
	 */
	const guards = createPersonalGuards();
	let guardsReleased = $state(false);
	let guardPhase = $state<GuardPhase>('running');
	let guardResumeIn = $state(0);
	// The spiral release (docs/SPEC.md) fires in a room exactly as it does
	// solo; solo had a banner and a cue for it and the room had nothing —
	// the resistance vanished for ten seconds unexplained (audit 2026-09-09).
	let spiralActive = $state(false);
	function syncGuards() {
		guardsReleased = guards.released;
		guardPhase = guards.phase;
		guardResumeIn = guards.resumeIn;
		spiralActive = guards.spiralActive;
	}

	const target = $derived(guardsReleased ? 0 : prescribed);

	// The guards' countdowns run on a local second — the room's clock is the
	// room's, and a rider's own recovery must not wait on it.
	$effect(() => {
		if (!trainer) return;
		const id = setInterval(() => {
			guards.tick();
			syncGuards();
		}, 1000);
		return () => clearInterval(id);
	});

	/**
	 * A local re-check while a sprint is on the board (#789). The window is a
	 * deadline, not a state the server keeps repeating: read off the last
	 * tick's `at`, a socket that drops mid-sprint freezes the clock inside the
	 * window and leaves SIM grade — or the single-speed 2xFTP command —
	 * applied for as long as the drop lasts. Nothing else re-evaluates,
	 * because no tick arrives to re-evaluate on.
	 */
	let sprintClock = $state(serverNow());
	$effect(() => {
		if (!deps.live.tick?.sprint) return;
		const id = setInterval(() => (sprintClock = serverNow()), 250);
		return () => clearInterval(id);
	});

	const sprintLive = $derived.by(() => {
		const sprint = deps.live.tick?.sprint;
		if (!sprint) return false;
		// serverNow() is the server's clock carried on this machine's, so it
		// keeps moving while the socket is down and stays skew-corrected when
		// it comes back (room/server-clock). sprintClock is what makes this
		// recompute without a tick.
		const at = Math.max(sprintClock, serverNow());
		return at >= sprint.startsAtMs && at < sprint.endsAtMs;
	});
	let sprintMode = false;
	$effect(() => {
		if (!trainer) return;
		// A sprint outranks the guards, deliberately. Auto-pause is an
		// INFERENCE that the rider left; the klaxon is an announced event they
		// are about to answer, and a rider who was sitting at zero when it
		// sounded would otherwise never be given the hill. (Tried the other
		// way round first; the two-rider e2e is what showed the cost.)
		if (sprintLive) {
			if (!sprintMode) {
				sprintMode = true;
				if (deps.profile.current.singleSpeed) {
					void trainer.setTargetPower(deps.profile.current.ftp * 2);
				} else {
					const grade = deps.profile.current.sprintGrade;
					void trainer.setSimulation(0);
					setTimeout(() => {
						if (sprintMode) void trainer?.setSimulation(grade);
					}, 500);
				}
			}
			return;
		}
		sprintMode = false;
		void trainer.setTargetPower(target);
	});

	async function ride(next: Trainer) {
		error = null;
		lastSampleAt = 0;
		unsubscribe.push(next.onStatus((s) => (status = s)));
		try {
			await next.connect();
			status = next.status;
			// t0 for the silence check above; the first frame should be ~1 s away.
			lastSampleAt = Date.now();
			unsubscribe.push(
				next.onSample((sample) => {
					lastSampleAt = sample.at;
					const metrics = arbitrate(
						{ trainer: sample, sensors: sensors.readings },
						sample.at,
					);
					// Only while the room is actually asking something of this
					// rider. With no target there is nothing to release, and a
					// rider resting in a room between sessions is not "paused"
					// — they are just in a room. Against the PRESCRIBED target,
					// too: the one the trainer holds is zero exactly when a
					// guard is already up.
					if (prescribed > 0) guards.sample(metrics, prescribed);
					else guards.reset();
					syncGuards();
					hrSource =
						metrics.from.heartRate === 'heart-rate' ||
						metrics.from.heartRate === 'trainer'
							? metrics.from.heartRate
							: null;
					deps.live.sendMetrics(
						wireMetrics(metrics, deps.profile.current.shareHr, bias),
					);
					const shared = deps.shared();
					if (shared?.phase === 'running')
						deps.recording.record(shared.elapsed, metrics.watts);
				}),
			);
			trainer = next;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			for (const off of unsubscribe) off();
			unsubscribe = [];
		}
	}
	/** Re-pairing is one button (rider report): drop the trainer and release
	 *  its subscription, keeping the ride buffer open so a fresh pair
	 *  continues the same session. */
	function unpair() {
		for (const off of unsubscribe) off();
		unsubscribe = [];
		void trainer?.setTargetPower(0);
		void trainer?.disconnect();
		trainer = null;
		error = null;
		status = 'disconnected';
		lastSampleAt = 0;
	}
	function stop() {
		deps.live.finish();
		unpair();
	}

	return {
		get trainer() {
			return trainer;
		},
		get error() {
			return error;
		},
		get hrSource() {
			return hrSource;
		},
		/** null while it is behaving; the room renders the rest (#520). */
		get fault() {
			return fault;
		},
		get bias() {
			return bias;
		},
		get target() {
			return target;
		},
		/** The rider's own guard state — the room's clock is unaffected (#788). */
		get guard() {
			return guardPhase;
		},
		get guardResumeIn() {
			return guardResumeIn;
		},
		/** The spiral-of-death release: targets off for a few seconds, on purpose. */
		get spiralActive() {
			return spiralActive;
		},
		nudgeBias,
		ride,
		unpair,
		stop,
	};
}
