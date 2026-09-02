import { arbitrate } from '$lib/ble/arbitrate';
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

	const target = $derived.by(() => {
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

	const sprintLive = $derived.by(() => {
		const sprint = deps.live.tick?.sprint;
		if (!sprint) return false;
		const at = deps.live.tick?.at ?? Date.now();
		return at >= sprint.startsAtMs && at < sprint.endsAtMs;
	});
	let sprintMode = false;
	$effect(() => {
		if (!trainer) return;
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
					hrSource =
						metrics.from.heartRate === 'heart-rate' ||
						metrics.from.heartRate === 'trainer'
							? metrics.from.heartRate
							: null;
					deps.live.sendMetrics(
						wireMetrics(metrics, deps.profile.current.shareHr),
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
		nudgeBias,
		ride,
		unpair,
		stop,
	};
}
