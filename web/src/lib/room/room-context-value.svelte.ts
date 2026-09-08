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
 * goes in whole**, not prop by prop. Twenty of these entries are pure
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
	avatarPreset?: string;
	totalXp?: number;
	ftpWatts?: number;
	weightKg?: number;
	joinedAt?: string;
	/** A banned row the crew also bans (#1150): Unban here lifts one level. */
	crewBanned?: boolean;
}

export interface AdminMedal {
	kind: string;
	rider: string;
	awardedAt: string;
}

export interface PlannedSession {
	id: string;
	workoutName: string;
	workoutJson: string;
	startsAt: string;
	createdBy: string;
}

/** RoomShell's props. Named here because the context is built from them. */
export interface RoomShellProps {
	/** The place standing in the content column. */
	children: import('svelte').Snippet;
	slug: string;
	role: string;
	roomName: string;
	/** Owner-set identity mark (#223) — an icon key (#447). */
	icon?: string;
	/** The room's reaction palette (#223); absent = SidePanel's base set. */
	cheers?: string[];
	code?: string;
	soundPack?: string;
	members?: AdminMember[];
	/** The private room's door list (#1224): let in, and outside. */
	crewVisible?: boolean;
	invited?: AdminMember[];
	crewOutside?: AdminMember[];
	onGrant: (userId: string) => void;
	onRevoke: (userId: string) => void;
	medals?: AdminMedal[];
	streakWeeks?: number;
	together?: Together | null;
	board?: BoardRow[];
	monthKj?: number;
	adminBusy?: boolean;
	onRole: (userId: string, role: string) => void;
	onRemove: (userId: string) => void;
	upcoming?: PlannedSession[];
	onSchedule: (name: string, json: string, startsAt: string) => void;
	onReschedule: (id: string, startsAt: string) => void;
	onUnschedule: (id: string) => void;
	onRsvp: (id: string, going: boolean) => void;
	/** Secret calendar-feed token (#245); '' hides the subscribe affordance. */
	icsToken?: string;
	onRotateIcs: () => void;
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
	myRole: () => string;
	stageSources: () => RoomStageSource[];
	onStage: () => RoomStageSource | null;
	reminders: () => RoomContext['reminders'];

	/** Shell-owned UI the places can ask for. */
	focusId: () => string | null;
	setFocus: (id: string | null) => void;
	openTv: () => void;
	openPicker: (intent?: 'start' | 'plan') => void;

	/** Actions the shell owns because they need more than the connection. */
	ban: (userId: string, name: string) => void;
	startScheduled: RoomContext['startScheduled'];
	copyIcsUrl: RoomContext['copyIcsUrl'];
}

export function roomContextValue(deps: ContextDeps): RoomContext {
	const { props, connection, roster } = deps;
	const live = connection.live;
	const av = connection.av;
	const ride = connection.ride;

	return {
		get slug() {
			return props.slug;
		},
		get roomName() {
			return props.roomName;
		},
		get icon() {
			return props.icon ?? '';
		},
		get code() {
			return props.code ?? '';
		},
		get cheers() {
			return props.cheers;
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
		get myRole() {
			return deps.myRole();
		},
		get sprint() {
			return live.tick?.sprint;
		},
		get game() {
			return live.tick?.game;
		},
		get bias() {
			return ride.bias;
		},
		nudgeBias: ride.nudgeBias,
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
		get upcoming() {
			return props.upcoming ?? [];
		},
		get icsToken() {
			return props.icsToken ?? '';
		},
		get together() {
			return props.together ?? null;
		},
		get board() {
			return props.board ?? [];
		},
		get streakWeeks() {
			return props.streakWeeks ?? 0;
		},
		get monthKj() {
			return props.monthKj ?? 0;
		},
		get adminBusy() {
			return props.adminBusy ?? false;
		},
		get members() {
			return props.members ?? [];
		},
		get crewVisible() {
			return props.crewVisible ?? false;
		},
		get invited() {
			return props.invited ?? [];
		},
		get crewOutside() {
			return props.crewOutside ?? [];
		},
		grant: (userId) => props.onGrant(userId),
		revoke: (userId) => props.onRevoke(userId),
		get medals() {
			return props.medals ?? [];
		},
		reschedule: (id, at) => props.onReschedule(id, at),
		unschedule: (id) => props.onUnschedule(id),
		rsvp: (id, going) => props.onRsvp(id, going),
		rotateIcs: () => props.onRotateIcs(),
		setRole: (userId, next) => props.onRole(userId, next),
		ban: (userId, name) => deps.ban(userId, name),
		removeMember: (userId) => props.onRemove(userId),
		startScheduled: deps.startScheduled,
		copyIcsUrl: deps.copyIcsUrl,
		get reminders() {
			return deps.reminders();
		},
	};
}
