<script lang="ts">
	import { navDrawer } from '$lib/nav/drawer.svelte';
	import { page } from '$app/state';
	import { setMuted } from '$lib/sound/cues';
	import { account } from '$lib/account.svelte';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { publishHud } from '$lib/hud/feed';
	import { toasts } from '$lib/toast.svelte';
	import { pickStage, sourceLabel } from '$lib/channel/stage';
	import { createRiders } from '$lib/channel/riders.svelte';
	import { createRoomSounds } from '$lib/session/session-sounds.svelte';
	import CheerLayer from '$lib/channel/CheerLayer.svelte';
	import Soundboard from '$lib/board/Soundboard.svelte';
	import ChannelStatus from '$lib/channel/ChannelStatus.svelte';
	import Jukebox from '$lib/channel/Jukebox.svelte';
	import PeopleSheet from '$lib/channel/PeopleSheet.svelte';
	import SidePanel from '$lib/channel/SidePanel.svelte';
	import SessionLayers, {
		createSessionLayers,
	} from '$lib/session/SessionLayers.svelte';
	import { setChannelContext } from '$lib/channel/context';
	import {
		channelContextValue,
		type RoomShellProps,
	} from '$lib/channel/context-value.svelte';
	import { readNotes, shouldRejoinVoice, tabId } from '$lib/channel/rejoin';
	import { stageSlot } from '$lib/channel/stage-slot.svelte';
	import { modals } from '$lib/modals.svelte';

	let props: RoomShellProps = $props();

	// #173: the connection outlives this page — you stay in the room while
	// you browse. Leaving is the rail's explicit button, never unmount.
	// svelte-ignore state_referenced_locally
	const connection = channelConnection.join(props.address);
	const live = connection.live;
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
			// The note is keyed by the place (#2449).
			key: props.address.key,
			avEnabled: !!account.me?.avEnabled,
			now: Date.now(),
		});
		if (back) void av.join({ mic: back.mic });
	});

	// Space is push-to-talk while that mode is on — never while typing.

	// The room's pack governs the cue mixer while you are here ('silent' =
	// visual cues only); leaving restores sound for the rest of the app.
	$effect(() => {
		if (props.soundPack === 'silent') {
			setMuted(true);
			return () => setMuted(false);
		}
	});

	// Roles change while you stand in the room: the tick's roster carries the
	// new one, the page's fetched prop is frozen at open (rider report).
	const myRole = $derived(
		live.tick?.roster.find((rider) => rider.id === account.me?.id)?.role ??
			props.role,
	);
	// The session's coach drives it (#2438): whoever opened it, until they
	// hand it off. With none open, anyone here may open one with a pick.
	const coach = $derived(live.tick?.state.coach);
	const canControl = $derived(coach ? coach === account.me?.id : true);
	// Managing the room's playlists and calendar stays a role's, not the
	// session's: the tick carries the crew's words, the room's door its own.
	const canManage = $derived(['owner', 'admin', 'coach'].includes(myRole));

	// Banning is reversible (Unban sets the role right back), so it gets an
	// undo toast rather than a confirm dialog (errors.md) — same pattern as
	// the Members page and settings' ban list (#666).
	function ban(userId: string, name: string) {
		const previousRole =
			(props.members ?? []).find((member) => member.id === userId)?.role ??
			'member';
		// Said once the server took it: a refused ban used to toast "Banned"
		// beside the refusal, with an Undo that fired a second refused call
		// (audit 2026-09-09).
		void Promise.resolve(props.onRole(userId, 'banned')).then((ok) => {
			if (ok === false) return;
			toasts.push(`Banned ${name}.`, {
				undo: () => void props.onRole(userId, previousRole),
			});
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

	// The roster with live numbers on it, plus you and the block you are in —
	// one module, fed by ticks (riders.svelte.ts).
	// The HUD feed (ADR-0041, #1665): published from the room, not the
	// Training place, so the floating window follows the ride to the Lounge,
	// and says what ChannelStatus would.
	$effect(() => {
		const phase = live.tick?.state.phase;
		if (phase !== 'countdown' && phase !== 'running' && phase !== 'paused')
			return;
		const you = roster.you;
		publishHud({
			watts: you.watts,
			target: you.target,
			remaining: Math.max(
				0,
				(shared?.totalSeconds ?? 0) - (shared?.elapsed ?? 0),
			),
			label: shared?.workoutName || 'Room ride',
			fault:
				live.status !== 'live' ? 'room' : rideCtl.fault ? 'trainer' : undefined,
		});
	});

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
			coach: coach === account.me?.id,
		}),
		running: () => running,
		shared: () => shared,
		segments: () => segments,
		workout: () => connection.workout(),
	});
	const riders = $derived(roster.riders);

	// ── One view, focus instead of layouts (#181 feedback) ───────────────────
	// The Metrics/Video/Media tabs are gone: tiles always fuse camera and
	// metrics, media lives in the panel/dock, and tapping a tile spotlights
	// that rider. Ephemeral by design — a focus is a glance, not a preference.
	let focusId = $state<string | null>(null);
	// The stage's menu, named (#280): av knows the tracks, only this page
	// knows whose they are.
	// The jukebox video is a stage source, and it leads (#316): what the room
	// is watching together belongs in the room, never in a window pasted over
	// the cam grid. A rider who wants a share instead picks it.
	// A pool track is heard, not seen (#267): no picture, so no seat — offering
	// one drew a black tile the dock never flew into (#1141).
	const stageSources = $derived([
		...(live.tick?.jukebox?.current?.videoId
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
	// The cues themselves are session-sounds.svelte.ts; what stays here is the
	// ranking, because only this component can see all four sources at once.
	//
	// `down` (reconnecting or offline) and not `!== 'live'`: the first connect
	// of every room entry passes through `connecting`, and a room that has not
	// dropped must not announce that it came back.
	const faultKind = $derived(
		live.down
			? 'room'
			: rideCtl.fault
				? 'trainer'
				: av.status === 'reconnecting' || av.status === 'failed'
					? 'voice'
					: av.status === 'live' && av.micFault
						? 'mic'
						: null,
	);
	createRoomSounds({
		phase: () => shared?.phase,
		countdownRemaining: () => shared?.countdownRemaining,
		fault: () => faultKind,
		sprint: () => live.tick?.sprint ?? rideCtl.blockSprint,
		guard: () => rideCtl.guard,
		spiral: () => rideCtl.spiralActive,
		block: () => (running ? roster.block?.index : undefined),
		game: () => live.tick?.game ?? null,
		me: () => account.me?.id,
	});

	// TV mode and the picker are the session's layers (SessionLayers.svelte):
	// the context opens them, Escape below closes them.
	const layers = createSessionLayers();

	// ADR-0020: the shell keeps the state, the places render the surface.
	// `props` goes in as the reactive object, not as its values: the context's
	// getters read through it on access, which is what keeps a place live when
	// the page re-fetches members or the announcement. The warning is about
	// capturing a value here, and this captures the reference — proved by
	// context-value.svelte.test.ts rather than argued.
	// svelte-ignore state_referenced_locally
	setChannelContext(
		channelContextValue({
			props,
			connection,
			roster,
			segments: () => segments,
			phase: () => phase,
			canControl: () => canControl,
			canManage: () => canManage,
			myRole: () => myRole,
			stageSources: () => stageSources,
			onStage: () => onStage,
			focusId: () => focusId,
			setFocus: (id) => (focusId = id),
			openTv: () => (layers.tv = true),
			openPicker: (intent) => layers.openPicker(intent),
			ban,
		}),
	);

	// ── Connection fault + jukebox helpers ────────────────────────────────────

	let peopleSheet = $state(false);
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key !== 'Escape') return;
		// The topmost layer only (audit 2026-09-09): one Escape used to close
		// TV mode, the picker, the sheet and the tile focus all at once — and
		// the layout's drawer on top of them (#1625).
		// …and a Modal of its own (the summary, #1969) answers first.
		// The picker and the people sheet count themselves modal for the
		// jukebox dock's sake — they are this shell's own layers, so only a
		// count ABOVE them means something is stacked on top (#1974). The
		// picker also answers Escape itself (#2513); whichever runs first
		// closes it and the other finds nothing left to do.
		const mine = (layers.setup.open ? 1 : 0) + (peopleSheet ? 1 : 0);
		if (navDrawer.open || modals.open > mine) return;
		if (layers.tv) layers.tv = false;
		else if (layers.setup.open) layers.setup.open = false;
		else if (peopleSheet) peopleSheet = false;
		else focusId = null;
	}}
/>

<SessionLayers
	{layers}
	{connection}
	{roster}
	{shared}
	{segments}
	{phase}
	roomName={props.roomName}
	code={props.code}
	onSchedule={props.onSchedule}
/>

<!-- The sidebar is the layout's (ADR-0020 — one instance across navigation);
     the room is content | people inside that frame. -->
<div class="bg-surface text-ink flex h-full overflow-hidden">
	<main class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
		<CheerLayer cheers={live.tick?.cheers} />
		<!-- The board floats over the room and is dragged where the rider
		     wants it (#877); it plays whether or not it is on screen. -->
		<Soundboard
			fires={live.tick?.board}
			roster={live.tick?.roster}
			onFire={(clipId) => live.fireClip(clipId)}
			onStop={() => live.stopClip()}
		/>

		<ChannelStatus />

		<!-- The jukebox dock floats over this column's bottom-right and RMF
		     says nothing may cover the player — so the content reserves the
		     dock's footprint rather than the player sitting on live data.
		     Seated on the lounge's stage it is content, and needs no gutter.

		     No default for the height, on purpose (#1702): keepSize removes
		     --pane-jukebox-dock-h while the dock is hidden, which is every
		     track the dock does not show — a pool track (ADR-0015: heard, not
		     seen) or a muted mix. An absent variable makes the whole calc()
		     invalid, so padding-bottom falls back to 0 and the gutter goes
		     with the player. A default resurrected it: 332px of nothing on
		     every place, and the Chat place's h-full column wore it worst —
		     its composer floated that far up the pane. -->
		<!-- The place's body: scrolls down, never sideways, and named so the
		     phone-width walk of the places can measure it (#1376). Not
		     page-body — the root layout's wraps this whole shell. -->
		<div
			data-testid="place-body"
			class="min-h-0 flex-1 overflow-y-auto"
			style={live.tick?.jukebox?.current && !stageSlot.seated
				? 'padding-bottom: calc(var(--pane-jukebox-dock-h) + 1.5rem)'
				: ''}
		>
			{@render props.children()}
		</div>
	</main>

	<div class="hidden shrink-0 xl:block">
		{@render panel()}
	</div>
</div>

<PeopleSheet bind:open={peopleSheet} {panel} />

{#snippet panel()}
	<SidePanel
		live={phase === 'live'}
		{riders}
		members={props.members}
		onCheer={(emoji) => live.cheer(emoji)}
		onPoke={(id) => live.poke(id)}
		onBan={myRole === 'owner' ? ban : undefined}
		cheers={props.cheers}
	>
		{#snippet player()}
			<Jukebox
				jukebox={live.tick?.jukebox}
				send={live.jukebox}
				refusal={live.jukeboxRefusal}
				address={props.address}
				targetRpm={live.tick?.state?.targetRpm ?? 0}
			/>
		{/snippet}
	</SidePanel>
{/snippet}
