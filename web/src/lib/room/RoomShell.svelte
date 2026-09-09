<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { setMuted } from '$lib/sound/cues';
	import { account } from '$lib/account.svelte';
	import { flatten } from '$lib/workout/engine';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { pickStage, sourceLabel } from '$lib/room/stage';
	import { createRiders } from '$lib/room/riders.svelte';
	import { createRoomSounds } from '$lib/room/room-sounds.svelte';
	import CheerLayer from '$lib/room/CheerLayer.svelte';
	import Soundboard from '$lib/board/Soundboard.svelte';
	import RoomStatus from '$lib/room/RoomStatus.svelte';
	import Jukebox from '$lib/room/Jukebox.svelte';
	import { createSessionSetup } from '$lib/room/session-setup.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import SessionPicker from '$lib/room/SessionPicker.svelte';
	import PeopleSheet from '$lib/room/PeopleSheet.svelte';
	import SidePanel from '$lib/room/SidePanel.svelte';
	import TvOverlay from '$lib/room/TvOverlay.svelte';
	import SessionSummary from '$lib/ride/SessionSummary.svelte';
	import { setRoomContext } from '$lib/room/context';
	import {
		roomContextValue,
		type RoomShellProps,
	} from '$lib/room/room-context-value.svelte';
	import { activePlace } from '$lib/nav/pages';
	import { createSummary } from '$lib/room/summary.svelte';
	import { remindersFor } from '$lib/room/reminders';
	import { readNotes, shouldRejoinVoice, tabId } from '$lib/room/rejoin';
	import { stageSlot } from '$lib/room/stage-slot.svelte';

	let props: RoomShellProps = $props();

	// The log lives on the Chat place now (#504, mock A), so the column shows
	// what was said while you were elsewhere. The room's own unread cannot say
	// it — standing in the room counts as reading it (#468) — so "seen" is
	// the Chat place being open, and everything before you joined is history.
	const chatPlace = $derived(
		activePlace(page.url.pathname, props.slug) === '/chat',
	);

	// #173: the connection outlives this page — you stay in the room while
	// you browse. Leaving is the rail's explicit button, never unmount.
	// svelte-ignore state_referenced_locally
	const connection = roomConnection.join(props.slug);
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
			slug: props.slug,
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
	const canControl = $derived(myRole === 'owner' || myRole === 'coach');

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

	// ── Composed, not owned (code-quality.md): the summary that reads the
	// recording, the roster, and the reminders — each its own module, the
	// shell wiring them to the connection. ─────────────────────────────────
	const summary = createSummary({
		slug: () => props.slug,
		recording,
		phase: () => shared?.phase,
		myName: () => account.me?.displayName,
		myId: () => account.me?.id,
		myExecution: () => you.execution,
	});
	const reminders = $derived(
		remindersFor(props.upcoming ?? [], live.tick?.at ?? Date.now()),
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
		sprint: () => live.tick?.sprint ?? null,
		guard: () => rideCtl.guard,
		spiral: () => rideCtl.spiralActive,
		block: () => (running ? roster.block?.index : undefined),
		game: () => live.tick?.game ?? null,
		me: () => account.me?.id,
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
		session.open = false;
	}

	// ── Session setup (#115) and planned rides (#116) ─────────────────────────
	// Composed, not owned: the shelf and its ranking, the calendar link, and
	// starting something already planned (session-setup.svelte.ts).
	const session = createSessionSetup({
		slug: () => props.slug,
		icsToken: () => props.icsToken ?? '',
		reset: () => recording.reset(),
		control: (action, payload) => live.control(action, payload),
	});

	// ADR-0020: the shell keeps the state, the places render the surface.
	// `props` goes in as the reactive object, not as its values: the context's
	// getters read through it on access, which is what keeps a place live when
	// the page re-fetches members or a planned session. The warning is about
	// capturing a value here, and this captures the reference — proved by
	// room-context-value.test.ts rather than argued.
	// svelte-ignore state_referenced_locally
	setRoomContext(
		roomContextValue({
			props,
			connection,
			roster,
			segments: () => segments,
			phase: () => phase,
			canControl: () => canControl,
			myRole: () => myRole,
			stageSources: () => stageSources,
			onStage: () => onStage,
			reminders: () => reminders,
			focusId: () => focusId,
			setFocus: (id) => (focusId = id),
			openTv: () => (tv = true),
			openPicker: (intent = 'start') => {
				session.intent = intent;
				session.open = true;
			},
			ban,
			startScheduled: session.startScheduled,
			copyIcsUrl: session.copyIcsUrl,
		}),
	);

	// ── Connection fault + jukebox helpers ────────────────────────────────────

	let peopleSheet = $state(false);
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			tv = false;
			session.open = false;
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
		roomName={props.roomName}
		code={props.code}
		live={phase === 'live'}
		workoutName={shared?.workoutName ?? ''}
		playing={!!live.tick?.jukebox?.current}
		sprint={live.tick?.sprint ?? null}
		onExit={() => (tv = false)}
	/>
{/if}

{#if session.open}
	<SessionPicker
		shelf={session.shelf}
		shelfError={session.custom.error}
		onRetryShelf={() => void session.custom.retry()}
		intent={session.intent}
		ftp={profile.current.ftp}
		busy={props.adminBusy}
		gameRunning={!!live.tick?.game}
		onStart={(workout) => startWorkout(workout)}
		onPlan={(name, json, at) => {
			props.onSchedule(name, json, at);
			session.open = false;
		}}
		onStartGame={(id) => {
			live.control('game', undefined, id);
			session.open = false;
		}}
		onClose={() => (session.open = false)}
	/>
{/if}

{#if shared?.phase === 'done' && summary.ready && !summary.dismissed}
	<!-- The summary has to call out (#359). It used to render at the bottom of
	     the main column, so a session ended while you were looking at the stage
	     and nothing said so — a modal is the room telling you it is over. -->
	<Modal
		label="Session summary"
		class="max-h-[88dvh] max-w-5xl overflow-y-auto"
		onclose={() => summary.dismiss()}
	>
		<SessionSummary
			subtitle="{props.roomName} · {shared.workoutName} · {new Date().toLocaleDateString()}"
			samples={recording.samples}
			ftp={you.ftp}
			execution={you.execution}
			medal={summary.medal}
			roomName={props.roomName}
		>
			{#snippet actions()}
				<div class="flex flex-wrap gap-2">
					<!-- The end links forward (#1331): the ride the room saved for
					     you, found by the session it belongs to once the save lands. -->
					{#if summary.rideId}
						<a href="/history/{summary.rideId}" class="btn btn-primary"
							>See your ride</a
						>
					{/if}
					<button onclick={() => summary.dismiss()} class="btn btn-secondary"
						>Back to the lounge</button
					>
				</div>
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
			onStop={() => live.stopClip()}
		/>

		<RoomStatus />

		<!-- The jukebox dock floats over this column's bottom-right and RMF
		     says nothing may cover the player — so the content reserves the
		     dock's footprint rather than the player sitting on live data.
		     Seated on the lounge's stage it is content, and needs no gutter. -->
		<!-- The place's body: scrolls down, never sideways, and named so the
		     phone-width walk of the places can measure it (#1376). Not
		     page-body — the root layout's wraps this whole shell. -->
		<div
			data-testid="place-body"
			class="min-h-0 flex-1 overflow-y-auto"
			style={live.tick?.jukebox?.current && !stageSlot.seated
				? 'padding-bottom: calc(var(--pane-jukebox-dock-h, 308px) + 1.5rem)'
				: ''}
		>
			{@render props.children()}
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
		members={props.members}
		{missed}
		onOpenChat={() => void goto(`/r/${props.slug}/chat`)}
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
				slug={props.slug}
				targetRpm={live.tick?.state?.targetRpm ?? 0}
			/>
		{/snippet}
	</SidePanel>
{/snippet}
