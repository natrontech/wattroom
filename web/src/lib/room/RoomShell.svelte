<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { setMuted } from '$lib/sound/cues';
	import { account } from '$lib/account.svelte';
	import type { Crew } from '$lib/room/room-data';
	import { api } from '$lib/api';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import { flatten } from '$lib/workout/engine';
	import { buildShelf } from '$lib/workout/shelf';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { pickStage, sourceLabel } from '$lib/room/stage';
	import { parseSharedSegments } from '$lib/room/workout';
	import { createRiders } from '$lib/room/riders.svelte';
	import { createRoomSounds } from '$lib/room/room-sounds.svelte';
	import CheerLayer from '$lib/room/CheerLayer.svelte';
	import Soundboard from '$lib/board/Soundboard.svelte';
	import FaultBanner from '$lib/room/FaultBanner.svelte';
	import Jukebox from '$lib/room/Jukebox.svelte';
	import { createCustomStore } from '$lib/workout/custom.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import SessionPicker from '$lib/room/SessionPicker.svelte';
	import PeopleSheet from '$lib/room/PeopleSheet.svelte';
	import SidePanel from '$lib/room/SidePanel.svelte';
	import TvOverlay from '$lib/room/TvOverlay.svelte';
	import SessionSummary from '$lib/ride/SessionSummary.svelte';
	import { setRoomContext } from '$lib/room/context';
	import { activePlace } from '$lib/nav/pages';
	import { createSummary } from '$lib/room/summary.svelte';
	import { remindersFor } from '$lib/room/reminders';
	import { readNotes, shouldRejoinVoice, tabId } from '$lib/room/rejoin';
	import { stageSlot } from '$lib/room/stage-slot.svelte';

	interface AdminMember {
		id: string;
		displayName: string;
		role: string;
		avatarUrl?: string;
		avatarPreset?: string;
		totalXp?: number;
		ftpWatts?: number;
		weightKg?: number;
		joinedAt?: string;
	}
	interface AdminMedal {
		kind: string;
		rider: string;
		awardedAt: string;
	}
	let {
		children,
		slug,
		role,
		roomName,
		icon = '',
		cheers = undefined,
		code = '',
		soundPack = 'base',
		members = [],
		medals = [],
		streakWeeks = 0,
		crew = null,
		monthKj = 0,
		adminBusy = false,
		onRole,
		onRemove,
		upcoming = [],
		onSchedule,
		onReschedule,
		onUnschedule,
		onRsvp,
		icsToken = '',
		onRotateIcs,
	}: {
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
		medals?: AdminMedal[];
		streakWeeks?: number;
		crew?: Crew | null;
		monthKj?: number;
		adminBusy?: boolean;
		onRole: (userId: string, role: string) => void;
		onRemove: (userId: string) => void;
		upcoming?: {
			id: string;
			workoutName: string;
			workoutJson: string;
			startsAt: string;
			createdBy: string;
		}[];
		onSchedule: (name: string, json: string, startsAt: string) => void;
		onReschedule: (id: string, startsAt: string) => void;
		onUnschedule: (id: string) => void;
		onRsvp: (id: string, going: boolean) => void;
		/** Secret calendar-feed token (#245); '' hides the subscribe affordance. */
		icsToken?: string;
		onRotateIcs: () => void;
	} = $props();

	// The log lives on the Chat place now (#504, mock A), so the column shows
	// what was said while you were elsewhere. The room's own unread cannot say
	// it — standing in the room counts as reading it (#468) — so "seen" is
	// the Chat place being open, and everything before you joined is history.
	const chatPlace = $derived(activePlace(page.url.pathname, slug) === '/chat');

	// #173: the connection outlives this page — you stay in the room while
	// you browse. Leaving is the rail's explicit button, never unmount.
	// svelte-ignore state_referenced_locally
	const connection = roomConnection.join(slug);
	const live = connection.live;

	// The connection owns the log and what you have not seen of it (#568) —
	// this only reports where the router is standing, which is the one thing
	// a store above the router cannot know. Leaving the room's pages hands
	// the answer back: the sidebar's Chat place marks it from here on.
	$effect(() => {
		connection.readingChat(chatPlace);
		return () => connection.readingChat(false);
	});
	const missed = $derived(connection.missed());
	const av = connection.av;
	// Owned by the connection, not by this component (#521): the trainer and
	// what it has recorded outlive every navigation inside the room, and the
	// ride's metrics keep one seq stream for the whole session (#522).
	const profile = connection.profile;
	const recording = connection.recording;
	const rideCtl = connection.ride;
	// The rail's "voice is busy" link lands you IN the channel, not next to it
	// (#251): ?voice=1 auto-joins once on mount; join() is idempotent.
	if (page.url.searchParams.has('voice') && account.me?.avEnabled)
		void av.join();

	// A refresh puts you back in voice, and nothing else does (#480). The
	// note this tab left behind says which room and how recently; rejoin.ts
	// decides, and the mic comes back exactly as the rider left it — the
	// camera does not, because nothing here opens a capture device that was
	// already shut. Waits for the account: a reload is precisely the cold
	// start where avEnabled is not known yet at init.
	let rejoinAsked = false;
	$effect(() => {
		if (rejoinAsked || !account.loaded) return;
		rejoinAsked = true;
		if (page.url.searchParams.has('voice')) return; // that mount is spoken for
		const back = shouldRejoinVoice({
			notes: readNotes(),
			tab: tabId(),
			slug,
			avEnabled: !!account.me?.avEnabled,
			now: Date.now(),
		});
		if (back) void av.join({ mic: back.mic });
	});

	// Space is push-to-talk while that mode is on — never while typing.

	// The room's pack governs the cue mixer while you are here ('silent' =
	// visual cues only); leaving restores sound for the rest of the app.
	$effect(() => {
		if (soundPack === 'silent') {
			setMuted(true);
			return () => setMuted(false);
		}
	});

	// Roles change while you stand in the room: the tick's roster carries the
	// new one, the page's fetched prop is frozen at open (rider report).
	const myRole = $derived(
		live.tick?.roster.find((rider) => rider.id === account.me?.id)?.role ??
			role,
	);
	const canControl = $derived(myRole === 'owner' || myRole === 'coach');

	// Banning is reversible (Unban sets the role right back), so it gets an
	// undo toast rather than a confirm dialog (errors.md) — same pattern as
	// the Members page and settings' ban list (#666).
	function ban(userId: string, name: string) {
		const previousRole =
			members.find((member) => member.id === userId)?.role ?? 'member';
		onRole(userId, 'banned');
		toasts.push(`Banned ${name}.`, {
			undo: () => onRole(userId, previousRole),
		});
	}

	const shared = $derived(connection.shared());
	const running = $derived(shared?.phase === 'running');
	const phase = $derived(
		shared?.phase === 'countdown'
			? ('countdown' as const)
			: shared?.phase === 'running' || shared?.phase === 'paused'
				? ('live' as const)
				: ('lounge' as const),
	);
	const segments = $derived(connection.segments());

	// ── Composed, not owned (code-quality.md): the summary that reads the
	// recording, the roster, and the reminders — each its own module, the
	// shell wiring them to the connection. ─────────────────────────────────
	const summary = createSummary({
		slug: () => slug,
		recording,
		phase: () => shared?.phase,
		myName: () => account.me?.displayName,
		myExecution: () => you.execution,
	});
	const reminders = $derived(
		remindersFor(upcoming, live.tick?.at ?? Date.now()),
	);

	// The roster with live numbers on it, plus you and the block you are in —
	// one module, fed by ticks (riders.svelte.ts).
	const roster = createRiders({
		live,
		av,
		recording,
		myId: () => account.me?.id,
		myName: () => account.me?.displayName,
		myTarget: () => rideCtl.target,
		fallback: () => ({
			ftp: profile.current.ftp,
			kg: profile.current.kg,
			coach: canControl,
		}),
		running: () => running,
		shared: () => shared,
		segments: () => segments,
		workout: () => connection.workout(),
	});
	const riders = $derived(roster.riders);
	const you = $derived(roster.you);
	const block = $derived(roster.block);

	// ── One view, focus instead of layouts (#181 feedback) ───────────────────
	// The Metrics/Video/Media tabs are gone: tiles always fuse camera and
	// metrics, media lives in the panel/dock, and tapping a tile spotlights
	// that rider. Ephemeral by design — a focus is a glance, not a preference.
	let tv = $state(false);
	let focusId = $state<string | null>(null);
	// The stage's menu, named (#280): av knows the tracks, only this page
	// knows whose they are.
	// The jukebox video is a stage source, and it leads (#316): what the room
	// is watching together belongs in the room, never in a window pasted over
	// the cam grid. A rider who wants a share instead picks it.
	const stageSources = $derived([
		...(live.tick?.jukebox?.current
			? [
					{
						key: 'jukebox',
						kind: 'jukebox' as const,
						gen: live.tick.jukebox.current.videoId,
						label: live.tick.jukebox.current.title || 'the jukebox',
					},
				]
			: []),
		...av.stageSources.map((source) => {
			const rider = riders.find((candidate) => candidate.id === source.id);
			return {
				key: source.key,
				kind: source.kind,
				riderId: source.id,
				gen: String(source.gen),
				label: sourceLabel(source.kind, rider?.name, rider?.you),
			};
		}),
	]);
	const onStage = $derived(pickStage(stageSources, av.stagePick));

	// ── Sounds follow state (riders are not watching) ─────────────────────────
	// The cues themselves are room-sounds.svelte.ts; what stays here is the
	// ranking, because only this component can see all four sources at once.
	//
	// `reconnecting` and not the banner's `!== 'live'`: the first connect of
	// every room entry passes through `connecting`, and a room that has not
	// dropped must not announce that it came back.
	const faultKind = $derived(
		live.status === 'reconnecting'
			? 'room'
			: rideCtl.fault
				? 'trainer'
				: av.status === 'reconnecting'
					? 'voice'
					: av.status === 'live' && av.micFault
						? 'mic'
						: null,
	);
	createRoomSounds({
		phase: () => shared?.phase,
		countdownRemaining: () => shared?.countdownRemaining,
		fault: () => faultKind,
	});

	// ── Coach controls ────────────────────────────────────────────────────────
	function startWorkout(picked: import('$lib/workout/types').Workout) {
		recording.reset();
		const flat = flatten(picked);
		const total = flat.reduce(
			(t, s) => Math.max(t, s.startSeconds + s.seconds),
			0,
		);
		live.control('pick', {
			name: picked.name,
			json: JSON.stringify(picked),
			totalSeconds: total,
		});
		live.control('start');
		setup = false;
	}

	// ADR-0020: the shell keeps the state, the places render the surface.
	setRoomContext({
		get slug() {
			return slug;
		},
		get roomName() {
			return roomName;
		},
		get icon() {
			return icon;
		},
		get code() {
			return code;
		},
		get cheers() {
			return cheers;
		},
		get riders() {
			return riders;
		},
		get you() {
			return you;
		},
		get block() {
			return block;
		},
		get segments() {
			return segments;
		},
		get workout() {
			return connection.workout();
		},
		get shared() {
			return shared;
		},
		get phase() {
			return phase;
		},
		get canControl() {
			return canControl;
		},
		get myRole() {
			return myRole;
		},
		get sprint() {
			return live.tick?.sprint;
		},
		get game() {
			return live.tick?.game;
		},
		get bias() {
			return rideCtl.bias;
		},
		nudgeBias: rideCtl.nudgeBias,
		get trainer() {
			return rideCtl.trainer;
		},
		get hrSource() {
			return rideCtl.hrSource;
		},
		get rideError() {
			return rideCtl.error;
		},
		get pairing() {
			return live.pairing;
		},
		pair: () => void rideCtl.ride(new FtmsTrainer()),
		pairSimulated: () =>
			void rideCtl.ride(
				new SimulatedTrainer({ baseWatts: profile.current.ftp * 0.75 }),
			),
		unpair: rideCtl.unpair,
		control: (kind, payload, id) =>
			live.control(kind as never, payload as never, id),
		openPicker: (intent = 'start') => {
			setupIntent = intent;
			setup = true;
		},
		openTv: () => (tv = true),
		get stageSources() {
			return stageSources;
		},
		get onStage() {
			return onStage;
		},
		pickStage: (key) => av.setStage(key),
		attachStage: (node, key) => av.attachStage(node, key),
		attachVideo: (id, node) => av.attach(id, node),
		videoOf: (id) => av.videoOf[id],
		get focusId() {
			return focusId;
		},
		setFocus: (id) => (focusId = id),
		poke: (id) => live.poke(id),
		get upcoming() {
			return upcoming;
		},
		get icsToken() {
			return icsToken;
		},
		get crew() {
			return crew;
		},
		get streakWeeks() {
			return streakWeeks;
		},
		get monthKj() {
			return monthKj;
		},
		get adminBusy() {
			return adminBusy;
		},
		get members() {
			return members;
		},
		get medals() {
			return medals;
		},
		schedule: (name, json, at) => onSchedule(name, json, at),
		reschedule: (id, at) => onReschedule(id, at),
		unschedule: (id) => onUnschedule(id),
		rsvp: (id, going) => onRsvp(id, going),
		rotateIcs: () => onRotateIcs(),
		setRole: (userId, next) => onRole(userId, next),
		ban,
		removeMember: (userId) => onRemove(userId),
		startScheduled,
		copyIcsUrl,
		get reminders() {
			return reminders;
		},
	});

	// ── Session setup (#115, redesigned as SessionPicker) ─────────────────────
	let setup = $state(false);
	let setupIntent = $state<'start' | 'plan'>('start');
	const custom = createCustomStore();
	// Recently ridden first: the rider's history ranks the shelf.
	let recency = $state<Map<string, number>>(new Map());
	$effect(() => {
		if (!setup || recency.size) return;
		void api<{ rides: { workoutName: string }[] }>('/api/rides').then((res) => {
			if (!res.ok) return;
			const ranked = new Map<string, number>();
			res.data.rides.forEach((ride, i) => {
				if (!ranked.has(ride.workoutName)) ranked.set(ride.workoutName, i);
			});
			recency = ranked;
		});
	});
	const shelf = $derived(
		buildShelf(custom.all)
			.map((entry) => ({
				...entry,
				recent: recency.has(entry.workout.name),
			}))
			.sort(
				(a, b) =>
					(recency.get(a.workout.name) ?? 999) -
					(recency.get(b.workout.name) ?? 999),
			),
	);
	// The quick-start on the lounge floor offers the most recently ridden.

	// ── Planned rides (#116) ──────────────────────────────────────────────────
	/** Startable a little early and through the grace the server keeps it visible. */
	function copyIcsUrl() {
		void navigator.clipboard.writeText(
			`${location.origin}/api/rooms/${slug}/calendar/${icsToken}.ics`,
		);
		toasts.push(
			'Calendar link copied — subscribe "from URL" in your calendar app.',
		);
	}

	// Moving a plan (#258): "move" folds a WhenPicker out under the card row.
	function startScheduled(entry: (typeof upcoming)[number]) {
		const segments = parseSharedSegments(entry.workoutJson);
		const total = segments.reduce(
			(t, s) => Math.max(t, s.startSeconds + s.seconds),
			0,
		);
		if (total === 0) return;
		recording.reset();
		live.control('pick', {
			name: entry.workoutName,
			json: entry.workoutJson,
			totalSeconds: total,
		});
		live.control('start');
	}

	// ── Connection fault + jukebox helpers ────────────────────────────────────
	let droppedAt = $state<number | null>(null);
	$effect(() => {
		if (live.status === 'reconnecting' && droppedAt === null)
			droppedAt = Date.now();
		if (live.status === 'live') droppedAt = null;
	});

	let peopleSheet = $state(false);
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			tv = false;
			setup = false;
			peopleSheet = false;
			focusId = null;
		}
	}}
/>

{#if tv}
	<TvOverlay
		{riders}
		{segments}
		total={shared?.totalSeconds ?? 0}
		elapsed={shared?.elapsed ?? 0}
		{block}
		{roomName}
		{code}
		live={phase === 'live'}
		workoutName={shared?.workoutName ?? ''}
		playing={!!live.tick?.jukebox?.current}
		onExit={() => (tv = false)}
	/>
{/if}

{#if setup}
	<SessionPicker
		{shelf}
		intent={setupIntent}
		ftp={profile.current.ftp}
		busy={adminBusy}
		gameRunning={!!live.tick?.game}
		onStart={(workout) => startWorkout(workout)}
		onPlan={(name, json, at) => {
			onSchedule(name, json, at);
			setup = false;
		}}
		onStartGame={(id) => {
			live.control('game', undefined, id);
			setup = false;
		}}
		onClose={() => (setup = false)}
	/>
{/if}

{#if shared?.phase === 'done' && recording.samples.length >= 60 && !summary.dismissed}
	<!-- The summary has to call out (#359). It used to render at the bottom of
	     the main column, so a session ended while you were looking at the stage
	     and nothing said so — a modal is the room telling you it is over. -->
	<Modal
		label="Session summary"
		class="max-h-[88dvh] max-w-5xl overflow-y-auto"
		onclose={() => summary.dismiss()}
	>
		<SessionSummary
			subtitle="{roomName} · {shared.workoutName} · {new Date().toLocaleDateString()}"
			samples={recording.samples}
			ftp={you.ftp}
			execution={you.execution}
			medal={summary.medal}
			{roomName}
		>
			{#snippet actions()}
				<button onclick={() => summary.dismiss()} class="btn btn-secondary"
					>Back to the lounge</button
				>
			{/snippet}
		</SessionSummary>
	</Modal>
{/if}

<!-- The sidebar is the layout's (ADR-0020 — one instance across navigation);
     the room is content | people inside that frame. -->
<div class="bg-surface text-ink flex h-full overflow-hidden">
	<main class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
		<CheerLayer cheers={live.tick?.cheers} />
		<!-- The board floats over the room and is dragged where the rider
		     wants it (#877); it plays whether or not it is on screen. -->
		<Soundboard
			fires={live.tick?.board}
			onFire={(clipId) => live.fireClip(clipId)}
		/>

		<!-- Room-level status belongs to the shell, not to a place: a dropped
		     connection is true on every one of them, and errors.md wants it
		     persistent rather than a toast the rider will not see. -->
		{#if live.status !== 'live'}
			<div class="shrink-0 px-5 pt-4">
				<FaultBanner
					fault={{ kind: 'room', state: 'reconnecting' }}
					bufferedSeconds={droppedAt
						? Math.round((Date.now() - droppedAt) / 1000)
						: 0}
					onRecover={() => location.reload()}
				/>
			</div>
		{:else if rideCtl.guard !== 'running'}
			<!-- The rider's own guard, in a room (#788): the group timeline runs
			     on without them, so nothing else on screen says why their
			     target went to zero. Ranked above the trainer's own faults for
			     the same reason auto-pause outranks everything solo — it is the
			     thing that just happened. -->
			<div class="shrink-0 px-5 pt-4">
				<div
					class="border-neon/40 bg-surface-raised flex items-center gap-4 rounded-lg border px-5 py-3"
				>
					{#if rideCtl.guard === 'resuming'}
						<span
							class="text-watt glow-text-strong font-display text-3xl font-bold tabular-nums"
							>{rideCtl.guardResumeIn}</span
						>
						<p class="text-sm">Picking back up — ease in.</p>
					{:else}
						<p class="text-sm">
							<span class="font-medium">Paused — you stopped pedalling.</span>
							<span class="text-muted"
								>Your targets are released; the room rides on. Start pedalling
								to pick them back up.</span
							>
						</p>
					{/if}
				</div>
			</div>
		{:else if rideCtl.fault}
			<!-- The trainer's own state, which the room never showed (#520): the
			     mock has simulated this banner since #39 and the product could
			     not reach it, so "Unpair trainer" was the only thing a rider
			     with no watts had to go on. Ranked above voice — a ride with no
			     power is broken; a ride with no talking is not. -->
			<div class="shrink-0 px-5 pt-4">
				<FaultBanner
					fault={{ kind: 'trainer', state: rideCtl.fault }}
					bufferedSeconds={0}
					onRecover={() => {
						rideCtl.unpair();
						void rideCtl.ride(new FtmsTrainer());
					}}
				/>
			</div>
		{:else if av.status === 'reconnecting'}
			<!-- Media gapped while the SDK retries (#234). -->
			<div class="shrink-0 px-5 pt-4">
				<FaultBanner
					fault={{ kind: 'voice', state: 'reconnecting' }}
					bufferedSeconds={0}
					onRecover={() => void av.join()}
				/>
			</div>
		{:else if av.status === 'live' && av.micFault}
			<!-- The capture died under an open mic (#640): we publish our own
			     WebAudio track, so LiveKit never notices and the room hears
			     silence with the icon still green. One big button back. -->
			<div class="shrink-0 px-5 pt-4">
				<FaultBanner
					fault={{ kind: 'mic', state: 'lost' }}
					bufferedSeconds={0}
					onRecover={() => void av.reconnectMic()}
				/>
			</div>
		{/if}

		{#if shared?.phase === 'paused'}
			<div class="shrink-0 px-5 pt-4">
				<Banner tone="warn">
					<p class="flex items-center gap-3 text-xs">
						<span class="bg-z5 h-2 w-2 shrink-0 animate-pulse rounded-full"
						></span>
						<span>
							<span class="font-medium">The session is paused.</span>
							<span class="text-muted"
								>Targets are released — spin easy until the coach resumes.</span
							>
						</span>
					</p>
				</Banner>
			</div>
		{/if}

		<!-- The jukebox dock floats over this column's bottom-right and RMF
		     says nothing may cover the player — so the content reserves the
		     dock's footprint rather than the player sitting on live data.
		     Seated on the lounge's stage it is content, and needs no gutter. -->
		<div
			class="min-h-0 flex-1 overflow-y-auto"
			style={live.tick?.jukebox?.current && !stageSlot.seated
				? 'padding-bottom: calc(var(--pane-jukebox-dock-h, 308px) + 1.5rem)'
				: ''}
		>
			{@render children()}
		</div>
	</main>

	<div class="hidden shrink-0 xl:block">
		{@render panel()}
	</div>
</div>

<PeopleSheet bind:open={peopleSheet} {panel} missed={!!missed} {chatPlace} />

{#snippet panel()}
	<SidePanel
		live={phase === 'live'}
		{riders}
		{members}
		{missed}
		onOpenChat={() => void goto(`/r/${slug}/chat`)}
		onCheer={(emoji) => live.cheer(emoji)}
		onPoke={(id) => live.poke(id)}
		onBan={myRole === 'owner' ? ban : undefined}
		{cheers}
	>
		{#snippet player()}
			<Jukebox
				jukebox={live.tick?.jukebox}
				send={live.jukebox}
				refusal={live.jukeboxRefusal}
				{slug}
			/>
		{/snippet}
	</SidePanel>
{/snippet}
