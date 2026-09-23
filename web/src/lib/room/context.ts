import type { PlaceAddress } from '$lib/room/address';
import { getContext, setContext } from 'svelte';
import type { Segment } from '$lib/workout/types';
import type { Block, RoomRider } from '$lib/room/view';
import type { Announcement, BoardRow, Together } from '$lib/room/room-data';
import type { GameState, SensorPairing, SprintState } from '$lib/protocol';
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
	/** Where the shell stands, and every path that follows (#2449). */
	readonly address: PlaceAddress;
	readonly roomName: string;
	/** The crew's join code (#1236); '' for a non-member. */
	readonly code: string;

	readonly riders: RoomRider[];
	readonly you: RoomRider;
	readonly block: Block | null;
	readonly segments: Segment[];
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
	/** The session's controls: the coach's, or anyone's while none is open (#2438). */
	readonly canControl: boolean;
	/** The room's own things — its playlists, its calendar: the owner's and
	 *  the crew's admins' (a coach's, on a room-era role), whoever is coaching. */
	readonly canManage: boolean;
	readonly myRole: string;
	/** A sprint window or a game owns the focus while it runs (ADR-0020). */
	readonly sprint: SprintState | undefined;
	readonly game: GameState | undefined;

	readonly bias: number;
	nudgeBias(step: number): void;
	/**
	 * Whether this screen writes the trainer's control point (#1853, #2075).
	 * False while another of the rider's screens holds the claim: the link,
	 * the samples and Forget all stay, the targets do not. What the bias trim
	 * is gated on — a trainer being linked is a different question.
	 */
	readonly actuating: boolean;
	readonly trainer: unknown;
	/** What this tab is paired to, for a ⚑ report's context (#1631). '' = nothing. */
	readonly trainerName: string;
	/**
	 * Which sensors this tab holds, and where the rider's other screens hold
	 * the rest (#610). Server truth — a place renders "paired on your phone"
	 * from this, never from its own click.
	 */
	readonly pairing: SensorPairing | undefined;

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
	/** Ask one connected rider's own screens for their attention. */
	poke(id: string): void;

	/**
	 * The coach's standing notice (ADR-0057), or null. It rides the room read
	 * rather than a fetch of its own, so it arrives with the room and follows
	 * a lobby ping like the plan and the roster do.
	 */
	readonly announcement: Announcement | null;
	/** Take it down. The coach's and the owner's; nothing else offers it. */
	clearAnnouncement(): void;
	readonly streakWeeks: number;
	readonly together: Together | null;
	readonly board: BoardRow[];
	readonly members: {
		id: string;
		displayName: string;
		role: string;
		avatarUrl?: string;
		totalXp?: number;
		ftpWatts?: number;
		weightKg?: number;
		joinedAt?: string;
		/** Earned achievement keys (#703). Never progress — ADR-0027. */
		badges?: string[];
		/** Medals this room awarded them, lifetime (#1371). */
		medals?: number;
		/** A banned row the crew also bans (#1150). */
		crewBanned?: boolean;
	}[];
	/**
	 * Ban with an undo toast, so a griefer is met wherever they appear — the
	 * tile, the roster row — rather than only where someone once wrote the
	 * entry (#951).
	 */
	ban(userId: string, name: string): void;
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
