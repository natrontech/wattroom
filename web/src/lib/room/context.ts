import type { PlaceAddress } from '$lib/room/address';
import { getContext, setContext } from 'svelte';
import type { Segment } from '$lib/workout/types';
import type { Block, RoomRider } from '$lib/room/view';
import type { Announcement, BoardRow, Together } from '$lib/room/room-data';
import type {
	GameState,
	RoomEvent,
	SensorPairing,
	SprintState,
} from '$lib/protocol';
import type { RsvpAnswer } from '$lib/room/rsvp';
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
	/** Where the shell stands, and every path that follows (#2449). */
	readonly address: PlaceAddress;
	readonly roomName: string;
	readonly icon: string;
	/** The crew's join code (#1236); '' for a non-member. */
	readonly code: string;
	readonly cheers: string[] | undefined;

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
	readonly canControl: boolean;
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

	readonly upcoming: {
		id: string;
		workoutName: string;
		workoutJson: string;
		startsAt: string;
		createdBy: string;
		/** Who said they are in (#450), first to say so first. */
		going?: { id: string; displayName: string }[];
		/** How many said no, and how many have not answered (#1011). Counts,
		 *  never names: who is out is a number the room reads, not a list it
		 *  reads out. Absent is zero. */
		out?: number;
		unanswered?: number;
		/** Your own answer — absent until you give one. */
		yourAnswer?: RsvpAnswer;
	}[];
	/** What already happened here (ADR-0034): the recaps, oldest first. */
	readonly recaps: import('$lib/protocol').SessionRecap[];
	/** Whether the recaps have arrived (#1538) — errors.md's four states. */
	readonly recapsState: 'loading' | 'ready' | 'failed';
	retryRecaps(): void;
	readonly icsToken: string;
	/**
	 * The coach's standing notice (ADR-0057), or null. It rides the room read
	 * rather than a fetch of its own, so it arrives with the room and follows
	 * a lobby ping like the plan and the roster do.
	 */
	readonly announcement: Announcement | null;
	/** Take it down. The coach's and the owner's; nothing else offers it. */
	clearAnnouncement(): void;
	readonly streakWeeks: number;
	readonly monthKj: number;
	readonly together: Together | null;
	readonly board: BoardRow[];
	readonly adminBusy: boolean;
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
	readonly medals: { kind: string; rider: string; awardedAt: string }[];
	/** Open to its crew (ADR-0038). */
	readonly crewVisible: boolean;
	/**
	 * A private room's named exceptions (#1224): crew-mates let in who have
	 * not walked in yet, and the crew-mates outside. Sent only to whoever may
	 * hand a door out — the room's owner, or the crew's owner or an admin
	 * (#2294) — so both lists are empty for everyone else.
	 */
	readonly invited: RoomContext['members'];
	readonly crewOutside: RoomContext['members'];
	/** Let a crew-mate in, or take the door back before they used it. */
	grant(userId: string): void;
	revoke(userId: string): void;
	/** Hand the room to a member (#1227); you stay on as a coach. */
	transfer(userId: string): void;
	reschedule(id: string, startsAt: string): void;
	unschedule(id: string): void;
	/** Answer for a planned session — in, out, or `null` to take the answer
	 *  back and be unanswered again (#1011). */
	rsvp(id: string, answer: RsvpAnswer | null): void;
	/** Resolves to whether the server took it; a caller that toasts waits. */
	rotateIcs(): void | Promise<boolean>;
	setRole(userId: string, role: string): void | Promise<boolean>;
	/**
	 * Ban with an undo toast, so a griefer is met wherever they appear — the
	 * tile, the roster row — rather than only where someone once wrote the
	 * entry (#951).
	 */
	ban(userId: string, name: string): void;
	removeMember(userId: string): void;
	startScheduled(entry: {
		id: string;
		workoutJson: string;
		workoutName: string;
	}): void;
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
