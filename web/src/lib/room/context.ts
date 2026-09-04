import { getContext, setContext } from 'svelte';
import type { Segment, Workout } from '$lib/workout/types';
import type { Block, RoomRider } from '$lib/room/view';
import type {
	GameState,
	RoomEvent,
	SensorPairing,
	SprintState,
} from '$lib/protocol';
import type { StageSource } from '$lib/room/stage';

/**
 * `StageSource` is the minimum `pickStage` needs; the room adds what the
 * picker draws — a generation, so a fresh track remounts, and a label.
 */
export interface RoomStageSource extends StageSource {
	gen: string;
	label: string;
	/** Whose camera or screen this is — absent for the jukebox (#506). */
	riderId?: string;
}

/**
 * What the room's places read (ADR-0020). `RoomLive` used to be one component
 * holding a header, a tab strip, a stage, a grid and a session dashboard — 1171
 * lines, twice the ceiling. The state did not need splitting, only the surface:
 * `RoomShell` still owns all of it and each place renders one part.
 *
 * Getters rather than values, so the places stay reactive across the context
 * boundary.
 */
export interface RoomContext {
	readonly slug: string;
	readonly roomName: string;
	readonly icon: string;
	readonly code: string;
	readonly cheers: string[] | undefined;

	readonly riders: RoomRider[];
	readonly you: RoomRider;
	readonly block: Block | null;
	readonly segments: Segment[];
	readonly workout: Workout | null;
	readonly shared:
		| {
				phase: string;
				workoutName?: string;
				elapsed?: number;
				totalSeconds?: number;
				countdownRemaining?: number;
		  }
		| undefined;
	/** Coarse phase the places branch on: lounge, countdown or live. */
	readonly phase: 'lounge' | 'countdown' | 'live';
	readonly canControl: boolean;
	readonly myRole: string;
	/** Explicit presence state (#706), shared across all of this rider's tabs. */
	readonly away: boolean;
	setAway(away: boolean): void;

	/** A sprint window or a game owns the focus while it runs (ADR-0020). */
	readonly sprint: SprintState | undefined;
	readonly game: GameState | undefined;

	readonly bias: number;
	nudgeBias(step: number): void;
	readonly trainer: unknown;
	readonly hrSource: 'heart-rate' | 'trainer' | null;
	readonly rideError: string | null;
	/**
	 * Which sensors this tab holds, and where the rider's other screens hold
	 * the rest (#610). Server truth — a place renders "paired on your phone"
	 * from this, never from its own click.
	 */
	readonly pairing: SensorPairing | undefined;
	pair(): void;
	pairSimulated(): void;
	unpair(): void;

	control(kind: string, payload?: unknown, id?: string): void;
	openPicker(intent?: 'start' | 'plan'): void;
	openTv(): void;

	/** Stage sources and the active one — the lounge's shared-screen surface. */
	readonly stageSources: RoomStageSource[];
	readonly onStage: RoomStageSource | null;
	pickStage(key: string): void;
	attachStage(node: HTMLElement, key: string): void;
	attachVideo(id: string, node: HTMLElement): void;
	videoOf(id: string): number | undefined;

	readonly focusId: string | null;
	setFocus(id: string | null): void;

	readonly upcoming: {
		id: string;
		workoutName: string;
		workoutJson: string;
		startsAt: string;
		createdBy: string;
		/** Who said they are in (#450), first to say so first. */
		going?: { id: string; displayName: string }[];
	}[];
	readonly icsToken: string;
	readonly streakWeeks: number;
	readonly monthKj: number;
	readonly adminBusy: boolean;
	readonly members: {
		id: string;
		displayName: string;
		role: string;
		avatarUrl?: string;
		avatarPreset?: string;
		totalXp?: number;
		ftpWatts?: number;
		weightKg?: number;
		joinedAt?: string;
	}[];
	readonly medals: { kind: string; rider: string; awardedAt: string }[];
	schedule(name: string, json: string, startsAt: string): void;
	reschedule(id: string, startsAt: string): void;
	unschedule(id: string): void;
	/** Say you are in for a planned session, or take it back (#450). */
	rsvp(id: string, going: boolean): void;
	rotateIcs(): void;
	setRole(userId: string, role: string): void;
	removeMember(userId: string): void;
	startScheduled(entry: { workoutJson: string; workoutName: string }): void;
	copyIcsUrl(): void;

	readonly reminders: RoomEvent[];
}

const KEY = Symbol('wattroom.room');

export function setRoomContext(ctx: RoomContext): void {
	setContext(KEY, ctx);
}

export function useRoom(): RoomContext {
	const ctx = getContext<RoomContext | undefined>(KEY);
	if (!ctx)
		throw new Error('a room place rendered outside /r/[slug] — no RoomShell');
	return ctx;
}
