import type { PlaceAddress } from '$lib/channel/address';
import { getContext, setContext } from 'svelte';
import type { Segment } from '$lib/workout/types';
import type { Block } from '$lib/workout/block';
import type { LiveRider } from '$lib/channel/types';
import type { Announcement } from '$lib/channels';
import type { GameState, SensorPairing, SprintState } from '$lib/protocol';
import type { StageSource } from '$lib/channel/stage';
import type { CrewPlan } from '$lib/crew-schedule';

/**
 * `StageSource` is the minimum `pickStage` needs; the channel adds what the
 * picker draws — a generation, so a fresh track remounts, and a label.
 */
export interface ChannelStageSource extends StageSource {
	gen: string;
	label: string;
	/** Whose camera or screen this is — absent for the jukebox (#506). */
	riderId?: string;
}

/**
 * What the channel's places read (ADR-0020). `RoomLive` used to be one component
 * holding a header, a tab strip, a stage, a grid and a session dashboard — 1171
 * lines, twice the ceiling. The state did not need splitting, only the surface:
 * `ChannelShell` still owns all of it and each place renders one part.
 *
 * Getters rather than values, so the places stay reactive across the context
 * boundary.
 */
export interface ChannelContext {
	/** Where the shell stands, and every path that follows (#2449). */
	readonly address: PlaceAddress;
	readonly name: string;
	/** The crew's join code (#1236); '' for a non-member. */
	readonly code: string;

	readonly riders: LiveRider[];
	readonly you: LiveRider;
	readonly block: Block | null;
	readonly segments: Segment[];
	readonly shared:
		| {
				phase: string;
				workoutName?: string;
				elapsed?: number;
				totalSeconds?: number;
				countdownRemaining?: number;
				/** Who holds it, and its id while one is open (#2438). */
				id?: string;
				coach?: string;
				coachName?: string;
		  }
		| undefined;
	/** Coarse phase the places branch on: lounge, countdown or live. */
	readonly phase: 'lounge' | 'countdown' | 'live';
	/** The session's controls: the coach's, or anyone's while none is open (#2438). */
	readonly canControl: boolean;
	/** The crew's own things — its playlists, its calendar: its owner's and
	 *  its admins', whoever is coaching. */
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
	/**
	 * The coach's hand-off to this person, shaped for `personMenu` — or
	 * undefined where it is not yours to give (#2636). One rule for the tile,
	 * the people column, the crew strip and SessionControls' list.
	 */
	handOffOf(
		userId: string,
		name: string,
	): { name: string; onSelect: () => void } | undefined;
	openPicker(intent?: 'start' | 'plan'): void;
	openTv(): void;

	/** Stage sources and the active one — the lounge's shared-screen surface. */
	readonly stageSources: ChannelStageSource[];
	readonly onStage: ChannelStageSource | null;
	pickStage(key: string): void;
	attachStage(node: HTMLElement, key: string): void;
	attachVideo(id: string, node: HTMLElement): void;
	videoOf(id: string): number | undefined;

	readonly focusId: string | null;
	setFocus(id: string | null): void;
	/** Ask one connected rider's own screens for their attention. */
	poke(id: string): void;

	/**
	 * The crew's newest announcement (ADR-0057), or null. It comes in the
	 * voice channel's load rather than a fetch of its own, so it arrives with
	 * the page and follows a lobby ping like the plan and the roster do.
	 */
	readonly announcement: Announcement | null;
	/** Take it down. The coach's and the owner's; nothing else offers it. */
	clearAnnouncement(): void;
	/**
	 * The next plan set to run in this voice channel (#2606), from the crew's
	 * schedule — what the reminder mail and the calendar event link here for.
	 * Null with none. Re-read on every lobby ping, and on `reloadPlan()`.
	 */
	readonly plan: CrewPlan | null;
	reloadPlan(): void;
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
		/** Medals this crew awarded them, lifetime (#1371). */
		medals?: number;
		/** A banned row the crew also bans (#1150). */
		crewBanned?: boolean;
	}[];
	/**
	 * The crew's ban for this person, with an undo toast — or undefined where
	 * you may not ban them. One rule for the tile and the roster row, so a
	 * griefer is met wherever they appear (#951, #2529).
	 */
	banOf(userId: string, name: string): (() => void) | undefined;
}

const KEY = Symbol('wattroom.room');

export function setChannelContext(ctx: ChannelContext): void {
	setContext(KEY, ctx);
}

export function useChannel(): ChannelContext {
	const ctx = getContext<ChannelContext | undefined>(KEY);
	if (!ctx)
		throw new Error(
			'a channel place rendered outside a voice channel — no ChannelShell',
		);
	return ctx;
}
