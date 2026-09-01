import { describeBlock, type Block, type RoomRider } from '$lib/room/view';
import { targetAt } from '$lib/workout/engine';
import type { Segment, Workout } from '$lib/workout/types';
import type { ServerTick } from '$lib/protocol';
import type { createRecording } from '$lib/room/recording.svelte';

interface RiderDeps {
	live: { readonly tick: ServerTick | null };
	av: {
		readonly videoOf: Record<string, number | undefined>;
		readonly voice: Record<string, string | undefined>;
		readonly speaking: Record<string, boolean | undefined>;
	};
	recording: ReturnType<typeof createRecording>;
	myId: () => string | undefined;
	myName: () => string | undefined;
	myTarget: () => number;
	/** What "you" looks like before the first tick names you. */
	fallback: () => { ftp: number; kg: number; coach: boolean };
	running: () => boolean;
	shared: () => { elapsed: number } | undefined;
	segments: () => Segment[];
	workout: () => Workout | null;
}

/**
 * The room's riders as the view model the places render (#39's design, made
 * real): one rider shape fed by live ticks, plus you and the block you are
 * in. Lifted out of RoomShell (code-quality.md's ceiling); behaviour
 * unchanged. Called during component init — the $derived inside needs the
 * component's context.
 */
export function createRiders(deps: RiderDeps) {
	// Last-known metrics survive a missed tick so a blip shows a stale tile,
	// never a zeroed one (the mock's `stale` state, real).
	const lastKnown = new Map<
		string,
		{ watts: number; cadence: number; hr: number; at: number }
	>();

	const riders = $derived.by((): RoomRider[] => {
		const tick = deps.live.tick;
		if (!tick) return [];
		const now = tick.at;
		return tick.roster.map((rider) => {
			const metrics = tick.riders?.[rider.id];
			if (metrics)
				lastKnown.set(rider.id, {
					watts: metrics.watts,
					cadence: metrics.cadence ?? 0,
					hr: metrics.hr ?? 0,
					at: now,
				});
			const known = lastKnown.get(rider.id);
			// The server drains its metrics map every tick, so a 1 Hz trainer
			// misses a 1 Hz tick constantly — treating every gap as a fault
			// flickered "no signal" and zeroed live watts between beats.
			// Last-known values ride through the gap; only real silence reads
			// as no signal.
			const gap = known ? now - known.at : Infinity;
			const held = !metrics && gap < 30_000 ? known : undefined;
			const stale = !!held && gap >= 5_000;
			const you = rider.id === deps.myId();
			const target = you
				? deps.myTarget()
				: deps.running() && deps.segments().length > 0 && rider.ftpWatts > 0
					? (targetAt(
							deps.segments(),
							rider.ftpWatts,
							deps.shared()?.elapsed ?? 0,
						).targetWatts ?? 0)
					: 0;
			return {
				id: rider.id,
				name: rider.name,
				ftp: rider.ftpWatts,
				kg: rider.weightKg,
				you,
				coach: rider.role !== 'member',
				cameraOn: !!deps.av.videoOf[rider.id],
				inVoice: rider.id in deps.av.voice,
				muted: deps.av.voice[rider.id] === 'muted',
				speaking: !!deps.av.speaking[rider.id],
				hue: [...rider.id].reduce(
					(h, c) => (h * 31 + c.charCodeAt(0)) % 360,
					7,
				),
				watts: metrics?.watts ?? held?.watts ?? 0,
				cadence: metrics?.cadence ?? held?.cadence ?? 0,
				hr: metrics?.hr ?? held?.hr ?? 0,
				stale,
				paused: false,
				lateJoined: false,
				target,
				execution: tick.execution?.[rider.id] ?? 1,
				trace: you ? deps.recording.trace : [],
				eliminated: tick.game?.riders?.[rider.id]?.eliminated,
			};
		});
	});
	const you = $derived(
		riders.find((r) => r.you) ?? {
			id: '',
			name: deps.myName() ?? 'you',
			ftp: deps.fallback().ftp,
			kg: deps.fallback().kg,
			you: true,
			coach: deps.fallback().coach,
			cameraOn: false,
			muted: false,
			speaking: false,
			hue: 210,
			watts: 0,
			cadence: 0,
			hr: 0,
			stale: false,
			paused: false,
			lateJoined: false,
			target: 0,
			execution: 1,
			trace: deps.recording.trace,
		},
	);
	const block = $derived(
		deps.running() && deps.segments().length > 0
			? describeBlock(
					targetAt(deps.segments(), you.ftp, deps.shared()?.elapsed ?? 0),
					deps.segments(),
					deps.workout(),
					you.ftp,
				)
			: null,
	);

	return {
		get riders(): RoomRider[] {
			return riders;
		},
		get you(): RoomRider {
			return you;
		},
		get block(): Block | null {
			return block;
		},
	};
}
