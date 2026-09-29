import type { FreeRide } from '$lib/ride/free-ride.svelte';
import type { Segment } from '$lib/workout/types';
import type { GameState, SensorPairing, SprintState } from '$lib/protocol';
import type { createRecording } from '$lib/session/recording.svelte';
import type { wireMetrics } from '$lib/session/wire';

/** What a session ride is handed by the connection that owns it. */
export interface RideDeps {
	/** The voice channel's socket: metrics go out, targets and ticks come in. */
	live: {
		sendMetrics(payload: ReturnType<typeof wireMetrics>): void;
		finish(): void;
		readonly tick:
			| { at?: number; game?: GameState; sprint?: SprintState }
			| null
			| undefined;
		/**
		 * The hub's answer to this tab's sensor claim (#610). Read for one
		 * question only — whether this screen is the one driving the trainer
		 * (#1853); the pairing surfaces read it for themselves.
		 */
		readonly pairing?: SensorPairing;
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
	/** On the running session's timeline, by the hub's word (ADR-0059). A
	 *  spectator's trainer is theirs: no target, no sprint, no record. */
	joined: () => boolean;
	/** What an armed free ride asks of the trainer while no session drives
	 *  it, and where its seconds go (ADR-0059). */
	free: Pick<
		FreeRide,
		'armed' | 'mode' | 'grade' | 'watts' | 'second' | 'nudge'
	>;
}
