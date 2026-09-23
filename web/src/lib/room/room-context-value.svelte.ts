import type { PlaceAddress } from '$lib/room/address';
import type { RoomContext, RoomStageSource } from '$lib/room/context';
import type { roomConnection } from '$lib/room/connection.svelte';
import type { createRiders } from '$lib/room/riders.svelte';
import type { BoardRow, Together } from '$lib/room/room-data';
import type { Segment } from '$lib/workout/types';

/**
 * ADR-0020's contract, built (#686). The shell keeps the state and the places
 * render the surface — this is the adapter between those two halves, and it
 * was 131 of RoomShell's 595 lines, sitting in the middle of the wiring it
 * adapts.
 *
 * The move only pays for itself because of the shape below: **the props object
 * goes in whole**, not prop by prop. Most of these entries are pure
 * pass-through, and re-plumbing each one through a `deps` argument would be
 * the same wall of names with an extra hop — the mistake #1049 made on
 * Sidebar and had to undo. One reactive reference carries all of them, and
 * only the values the shell genuinely computes need an accessor.
 */
export interface AdminMember {
	id: string;
	displayName: string;
	role: string;
	avatarUrl?: string;
	totalXp?: number;
	ftpWatts?: number;
	weightKg?: number;
	joinedAt?: string;
	/** A banned row the crew also bans (#1150): Unban here lifts one level. */
	crewBanned?: boolean;
}

/** RoomShell's props. Named here because the context is built from them. */
export interface RoomShellProps {
	/** The place standing in the content column. */
	children: import('svelte').Snippet;
	/** Where the shell stands, and every path that follows (#2449). */
	address: PlaceAddress;
	role: string;
	roomName: string;
	/** The room's reaction palette (#223); absent = SidePanel's base set. */
	cheers?: string[];
	/** The crew's join code (#1236), for the TV's idle screen. */
	code?: string;
	soundPack?: string;
	members?: AdminMember[];
	streakWeeks?: number;
	together?: Together | null;
	board?: BoardRow[];
	onRole: (userId: string, role: string) => void | Promise<boolean>;
	announcement?: RoomContext['announcement'];
	onClearAnnouncement?: () => void;
	/** Resolves false when the server refused — the picker stays open (#1766). */
	onSchedule: (
		name: string,
		json: string,
		startsAt: string,
	) => Promise<boolean> | boolean | void;
}

type Connection = ReturnType<typeof roomConnection.join>;
type Roster = ReturnType<typeof createRiders>;

/**
 * What the shell computes for itself and the context has to see. Everything
 * else reaches the context through one of the three objects above it.
 */
export interface ContextDeps {
	/** Whole and reactive — see the note on this module. */
	props: RoomShellProps;
	/** Owns live, av, ride and profile; the context reads all four through it. */
	connection: Connection;
	roster: Roster;

	segments: () => Segment[];
	phase: () => 'lounge' | 'countdown' | 'live';
	canControl: () => boolean;
	canManage: () => boolean;
	myRole: () => string;
	stageSources: () => RoomStageSource[];
	onStage: () => RoomStageSource | null;

	/** Shell-owned UI the places can ask for. */
	focusId: () => string | null;
	setFocus: (id: string | null) => void;
	openTv: () => void;
	openPicker: (intent?: 'start' | 'plan') => void;

	/** Actions the shell owns because they need more than the connection. */
	ban: (userId: string, name: string) => void;
}

export function roomContextValue(deps: ContextDeps): RoomContext {
	const { props, connection, roster } = deps;
	const live = connection.live;
	const av = connection.av;
	const ride = connection.ride;

	return {
		get address() {
			return props.address;
		},
		get roomName() {
			return props.roomName;
		},
		get code() {
			return props.code ?? '';
		},
		get riders() {
			return roster.riders;
		},
		get you() {
			return roster.you;
		},
		get block() {
			return roster.block;
		},
		get segments() {
			return deps.segments();
		},
		get shared() {
			return connection.shared();
		},
		get phase() {
			return deps.phase();
		},
		get canControl() {
			return deps.canControl();
		},
		get canManage() {
			return deps.canManage();
		},
		get myRole() {
			return deps.myRole();
		},
		// The coach's armed sprint, or the workout's own block (#2014) — the
		// server's wins, it is the one with a podium behind it.
		get sprint() {
			return live.tick?.sprint ?? ride.blockSprint ?? undefined;
		},
		get game() {
			return live.tick?.game;
		},
		get bias() {
			return ride.bias;
		},
		nudgeBias: ride.nudgeBias,
		get actuating() {
			return ride.actuating;
		},
		get trainerName() {
			return ride.trainer?.name ?? '';
		},
		get trainer() {
			return ride.trainer;
		},
		get pairing() {
			return live.pairing;
		},
		control: (kind, payload, id) =>
			live.control(kind as never, payload as never, id),
		openPicker: (intent = 'start') => deps.openPicker(intent),
		openTv: () => deps.openTv(),
		get stageSources() {
			return deps.stageSources();
		},
		get onStage() {
			return deps.onStage();
		},
		pickStage: (key) => av.setStage(key),
		attachStage: (node, key) => av.attachStage(node, key),
		attachVideo: (id, node) => av.attach(id, node),
		videoOf: (id) => av.videoOf[id],
		get focusId() {
			return deps.focusId();
		},
		setFocus: (id) => deps.setFocus(id),
		poke: (id) => live.poke(id),
		get announcement() {
			return props.announcement ?? null;
		},
		clearAnnouncement: () => props.onClearAnnouncement?.(),
		get together() {
			return props.together ?? null;
		},
		get board() {
			return props.board ?? [];
		},
		get streakWeeks() {
			return props.streakWeeks ?? 0;
		},
		get members() {
			return props.members ?? [];
		},
		ban: (userId, name) => deps.ban(userId, name),
	};
}
