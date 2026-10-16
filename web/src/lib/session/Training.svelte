<script lang="ts">
	// The Training place — the 3 m surface (ADR-0020). Was a tab inside
	// RoomLive, then a URL of the room's own; since #2449 a voice channel's.
	//
	// A FOCUS SLOT, not a fixed layout: sprint › game › shared screen › your
	// instrument. A sprint takes the screen and gives it back, a game replaces
	// the workout, a shared screen replaces both, and the instrument is what
	// returns. The player is never overlaid — RMF — so the numbers go below it.
	import CountdownScreen from '$lib/session/CountdownScreen.svelte';
	import CrewRows from '$lib/session/CrewRows.svelte';
	import { bottleFor } from '$lib/roadside';
	import RoadsideDeck from '$lib/channel/RoadsideDeck.svelte';
	import ExecutionMeter from '$lib/session/ExecutionMeter.svelte';
	import GamePanel from '$lib/session/GamePanel.svelte';
	import RidingSurface from '$lib/session/RidingSurface.svelte';
	import FlatRoad from '$lib/world/FlatRoad.svelte';
	import { createWorldView } from '$lib/world/world-view.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import BiasTrim from '$lib/session/BiasTrim.svelte';
	import BikeComputer from '$lib/session/BikeComputer.svelte';
	import { climbView } from '$lib/ride/climb-view';
	import { mapView } from '$lib/ride/map-view';
	import RideNarrator from '$lib/ride/RideNarrator.svelte';
	import { watchClimbCues } from '$lib/ride/climb-cues.svelte';
	import RaceRadio from '$lib/race/RaceRadio.svelte';
	import HrShare from '$lib/channel/HrShare.svelte';
	import RideBand from '$lib/session/RideBand.svelte';
	import MomentCard from '$lib/session/MomentCard.svelte';
	import Skyline from '$lib/ride/Skyline.svelte';
	import Users from '@lucide/svelte/icons/users';
	import { peopleFold } from '$lib/channel/people-fold.svelte';
	import { rideContext } from './ride-context';
	import MonitorUp from '@lucide/svelte/icons/monitor-up';
	import { goto } from '$app/navigation';
	import SessionFlag from '$lib/session/SessionFlag.svelte';
	import TrainerOverview from '$lib/session/TrainerOverview.svelte';
	import SessionControls from '$lib/session/SessionControls.svelte';
	import SprintMoment from '$lib/session/SprintMoment.svelte';
	import Stage from '$lib/channel/Stage.svelte';
	import TrainingPhone from '$lib/session/TrainingPhone.svelte';
	import TrainingLounge from '$lib/session/TrainingLounge.svelte';
	import { device, deviceWord } from '$lib/device.svelte';
	import { trainerTargetsNote } from '$lib/session/sensor-status';
	import { pictureKey } from '$lib/channel/stage';
	import { useChannel } from '$lib/channel/context';
	import { endGame } from '$lib/session/end-game';
	import { account } from '$lib/account.svelte';
	import { SESSION_COUNTDOWN_SECONDS } from '$lib/workout/ride-state';
	import { serverNow } from '$lib/server-clock';
	import { channelConnection } from '$lib/channel/connection.svelte';

	const channel = useChannel();
	// Another of the rider's screens drives the trainer (#2075). This one
	// keeps the link, the watts and Forget (ADR-0025, amended) and writes no
	// control point, so the trim is disabled and the card gets a place to say
	// why — it is otherwise hidden the moment a trainer is linked, which is
	// exactly the state this is about.
	const targetsNote = $derived(
		trainerTargetsNote(channel.pairing, deviceWord()),
	);
	const total = $derived(channel.shared?.totalSeconds ?? 0);
	const elapsed = $derived(channel.shared?.elapsed ?? 0);

	// A shared SCREEN takes the focus; the jukebox never does — it has one
	// player instance and it lives on the dock (RMF: no auto-advance offscreen).
	const share = $derived(
		channel.onStage && channel.onStage.key !== 'jukebox'
			? channel.onStage
			: null,
	);
	// The podium keeps the focus for a few seconds after the window — the
	// server holds the sprint on the board for 30 s, and the screen used to
	// hold the podium that long too: half a minute back in a block with no
	// watts, no target and no clock (audit 2026-09-09).
	const PODIUM_MS = 8_000;
	let now = $state(serverNow());
	$effect(() => {
		if (!channel.sprint) return;
		const id = setInterval(() => (now = serverNow()), 250);
		return () => clearInterval(id);
	});
	const sprintFocus = $derived(
		!!channel.sprint && now < channel.sprint.endsAtMs + PODIUM_MS,
	);
	// The session's own riders (ADR-0059). Everyone else in the channel is a
	// spectator: on the Lounge's tiles, never in the session's lists.
	const inRide = $derived(channel.riders.filter((r) => r.inSession));
	// Who this screen's bottle goes to, from the roadside (#3022).
	const watched = $derived(bottleFor(channel.riders, channel.focusId));
	async function leaveRide() {
		// Away first: this page joins whoever is on it.
		await goto(channel.address.home);
		channel.control('leave');
	}
	const inFocus = $derived(
		sprintFocus ? 'sprint' : channel.game ? 'game' : share ? 'media' : 'you',
	);
	// Only people actually turning the pedals are ranked. The server scores
	// nothing for a rider with no samples and returns 1 for them, which is
	// right for "before the first hard block" and absurd on a leaderboard:
	// a spectator sitting in the channel reads 100% and beats everyone riding.
	// `riding` is the server's word (#1016) — a coast holds it — so a rider
	// who freewheels for one sample no longer drops off the list and the
	// ranking stops re-sorting under their eyes (#1411).
	const riding = $derived(inRide.filter((r) => r.riding));
	// The world in slot 2, where this device has it on (#3031, ADR-0066): it
	// has the focus when nothing else takes it, holds under a shared screen,
	// and a world that cannot draw, or stops, leaves the slots as they were
	// until the rider asks for 3D again (#3080).
	const world = createWorldView();
	// Only on a session that rides a road (ADR-0066, #3663).
	const inWorld = $derived(world.on && !!channel.ridden);
	// The climb card on a session's road (#3645), on either layout.
	const climb = $derived(climbView(channel.ridden));
	const map = $derived(mapView(channel.ridden));
	watchClimbCues(() => climb);
	// The sprint carries its own numbers and Watt Golf hides the meter:
	// slots 3 to 5 stand empty while either has the focus.
	// Over the world a sprint is a moment card and your numbers stay (D12).
	const quiet = $derived(
		(inFocus === 'sprint' && !inWorld) ||
			(inFocus === 'game' && !!channel.game?.meterHidden),
	);
	// The world keeps its width: the people column folds while it rides (#3668).
	const docked = $derived(
		inWorld && !device.narrow && channel.phase === 'live',
	);
	$effect(() => {
		peopleFold.folded = docked;
		return () => (peopleFold.folded = false);
	});
	// The count-in over the world: the reveal flies, the digit hangs on the arch's banner (#3087, ADR-0046).
	const countingIn = $derived(inWorld && channel.phase === 'countdown');
	const ICON = 'btn btn-secondary h-11 w-11 p-0';
</script>

<RideNarrator
	view={channel.ridden}
	watts={channel.you.watts}
	ftp={channel.you.ftp}
	crew={inRide.filter((r) => !r.you)}
	sprintStartsAt={channel.sprint?.startsAtMs ?? null}
/>

{#if channel.phase === 'lounge'}
	<TrainingLounge {targetsNote} />
{:else if channel.phase === 'countdown' && !inWorld}
	<!-- One count-in for the surface (ADR-0046, #1800): the same screen a solo
	     ride draws, with a rider count instead of what is first up. -->
	<CountdownScreen
		remaining={channel.shared?.countdownRemaining ?? 0}
		title={channel.shared?.workoutName ?? ''}
		note="{inRide.length} rider{inRide.length === 1 ? '' : 's'}"
	>
		{#snippet controls()}
			<!-- The running header's card, ten seconds early (#2594): a rider
			     pulled in by someone else's start pairs during the count-in
			     rather than during the first interval. -->
			<div class="flex flex-wrap items-center justify-center gap-3">
				{#if !channel.trainer || targetsNote}<TrainerOverview compact />{/if}
				<SessionControls compact />
			</div>
		{/snippet}
	</CountdownScreen>
{:else if device.narrow}
	<!-- One column, the followed rider's instrument, the crew strip (#412). -->
	<TrainingPhone {climb} {map} />
{:else}
	{#snippet worldControls()}
		<!-- One row in slot 1 (TARGETS ride-road-world 7), and the people
		     column's sheet, folded away while the world rides. -->
		<div class="flex items-center gap-2">
			<SessionControls compact />
			<button
				onclick={() => channel.openTv()}
				class={ICON}
				aria-label="TV mode"
				title="TV mode"><MonitorUp size={20} /></button
			>
			{#if inWorld}
				<button
					onclick={() => (peopleFold.open = true)}
					class={ICON}
					aria-label="who is here"
					title="Who is here"><Users size={20} /></button
				>
			{/if}
			<SessionFlag />
			{#if channel.you.inSession}
				<!-- One short word, so the eyebrow keeps the row (slot 1's 860 px). -->
				<button
					onclick={leaveRide}
					class="btn btn-secondary btn-ride"
					aria-label="Leave the ride"
					title="Leave the ride">Leave</button
				>
			{/if}
		</div>
	{/snippet}
	{#snippet trainerLine()}
		{#if !channel.trainer || targetsNote}
			<div data-status-line><TrainerOverview compact /></div>
		{/if}
		{#if !inWorld && channel.ridden && world.reason}
			<FlatRoad reason={world.reason} onretry={world.retry} />
		{/if}
	{/snippet}
	{#snippet strip()}
		<IntervalGraph
			segments={channel.segments}
			{total}
			{elapsed}
			ftp={channel.you.ftp}
			trace={channel.you.trace}
			compact
			marker={false}
		/>
	{/snippet}
	{#snippet nowPlaying()}
		{@const current = channelConnection.current?.live.tick?.jukebox?.current}
		{#if current}
			<!-- Directly under the player, at its width (TARGETS ride-session-road 3). -->
			<p class="ride-panel truncate px-3 py-2 text-2xl leading-7">
				{current.title} · <span class="text-muted">{current.addedBy}</span>
			</p>
		{/if}
	{/snippet}
	{#snippet moment()}
		{#if channel.sprint}<MomentCard
				sprint={channel.sprint}
				roster={inRide}
			/>{/if}
	{/snippet}
	{#snippet digit()}
		<!-- A count to the start, not a reading: ink, no glow (G2). -->
		<p class="sr-only" role="status">
			Starting {channel.shared?.workoutName ?? 'the session'} in a moment
		</p>
		<span
			aria-hidden="true"
			data-testid="count-in"
			class="font-display text-ink text-[9rem] leading-none font-bold tabular-nums"
			>{channel.shared?.countdownRemaining}</span
		>
	{/snippet}
	{#snippet road()}
		{#await world.load() then { default: RideWorld }}
			{#if channel.ridden}
				<RideWorld
					road={channel.ridden.road}
					metre={() => channel.ridden ?? { m: 0, mps: 0 }}
					bunch={() => channel.ridden?.bunch ?? null}
					loop={channel.ridden.loop}
					watts={channel.you.watts}
					silent={channel.youStale}
					ftp={channel.you.ftp}
					progress={total > 0 ? elapsed / total : null}
					paused={inFocus === 'media'}
					countIn={countingIn
						? {
								left: channel.shared?.countdownRemaining ?? 0,
								total: SESSION_COUNTDOWN_SECONDS,
							}
						: null}
					look={world.look}
					onfail={world.fail}
					onflat={world.flatten}
				/>
			{/if}
		{/await}
	{/snippet}
	<RidingSurface
		class="h-full overflow-hidden {inWorld ? '' : 'p-4'}"
		world={inWorld ? road : undefined}
		stage={inFocus === 'media'}
		moment={inWorld && inFocus === 'sprint' ? moment : undefined}
		centre={countingIn ? digit : undefined}
		dockIn={countingIn}
		seat={docked ? nowPlaying : undefined}
	>
		{#snippet header()}
			<RideBand
				block={channel.block}
				{elapsed}
				{total}
				title={channel.shared?.workoutName ?? ''}
				context={rideContext(
					'Session',
					channel.shared?.workoutName ?? '',
					inRide.length,
				)}
				drives={!!channel.trainer && channel.actuating}
				wide={!inWorld}
				controls={worldControls}
				status={trainerLine}
				{strip}
			/>
			{#if channel.race}
				<div class="px-4 pb-3">
					<RaceRadio race={channel.race} />
				</div>
			{/if}
		{/snippet}

		{#snippet focus()}
			{#if inFocus === 'sprint' && channel.sprint && !inWorld}
				<section class="min-h-0 px-6">
					<SprintMoment
						sprint={channel.sprint}
						myWatts={channel.you.watts}
						roster={inRide}
					/>
				</section>
			{:else if inFocus === 'game' && channel.game}
				<section
					class="min-h-0 overflow-y-auto {inWorld ? 'px-4 py-3' : 'px-6'}"
				>
					<GamePanel
						game={channel.game}
						roster={channelConnection.current?.live.tick?.roster ?? []}
						canControl={channel.canControl}
						end={() => void endGame(channel)}
						me={account.me?.id}
					>
						{#snippet roadside()}<RoadsideDeck to={watched} />{/snippet}
					</GamePanel>
				</section>
			{:else if inFocus === 'media' && share}
				<section class="grid min-h-0 place-items-center px-6">
					<Stage
						sources={channel.stageSources}
						activeKey={share.key}
						trackKey={pictureKey(share)}
						onPick={(key) => channel.pickStage(key)}
						attach={(node) => channel.attachStage(node, share.key)}
					/>
				</section>
			{/if}
		{/snippet}

		{#snippet numbers()}
			{#if !quiet}
				<!-- One panel: the computer with its head, the trim, and whether
				     your heart rate reaches the call beside it (ADR-0008, #2804): the
				     button's heart alone, since its words would wrap the trim to a
				     second row, on a road into slot 1 (#4056). -->
				<BikeComputer
					docked
					{climb}
					{map}
					roadLine={!!channel.block?.road}
					road={channel.ridden
						? {
								speedKph: channel.ridden.mps * 3.6,
								km: channel.ridden.m / 1000,
								ofKm: channel.ridden.road.length / 1000,
							}
						: undefined}
					ftp={channel.you.ftp}
					cadence={channel.you.cadence}
					stale={channel.youStale}
					hr={channel.you.hr}
					watts={channel.you.watts}
					kg={channel.you.kg}
					lthr={channelConnection.current?.profile.current.lthr}
					execution={riding.length <= 1 && channel.you.inSession
						? channel.you.execution
						: undefined}
					target={channel.you.target > 0 ? channel.you.target : undefined}
					stats={channelConnection.current?.recording.live}
					race={channel.race ?? undefined}
				/>
				<div class="flex flex-col gap-2 px-4 pb-3">
					<div class="flex items-center gap-2">
						<BiasTrim
							ride
							bias={channel.bias}
							onBias={channel.trainer && channel.actuating
								? (step) => channel.nudgeBias(step)
								: undefined}
							hint={targetsNote
								? `${targetsNote} — trim them there`
								: undefined}
						/>
						<HrShare ride icon />
					</div>
					{#if riding.length > 1 && inFocus !== 'media' && inFocus !== 'game' && !inWorld}
						<!-- The live half of the execution score (#543), alone not a
						     leaderboard (#2635); below xl only, where the people column
						     does not carry it (#2882 L6-09). -->
						<div class="max-h-32 w-64 overflow-y-auto xl:hidden">
							<ExecutionMeter riders={riding} />
						</div>
					{/if}
				</div>
			{/if}
		{/snippet}

		{#snippet crew()}
			{#if (inWorld || !quiet) && inFocus !== 'game'}
				<!-- The crew, one list with or without a road: rows at the riding
				     floor, a sprint's card included (the box table). A game's panel
				     already lists everyone; a second list of the same people is what
				     the sprint branch refuses too. Flat, the rows lie side by side. -->
				<div class="py-2 {inWorld ? '' : 'flex px-2'}">
					<CrewRows
						row={!inWorld}
						riders={inRide}
						offsets={channel.ridden?.bunch?.offsets}
					/>
				</div>
			{/if}
		{/snippet}

		{#snippet horizon()}
			{#if inWorld && channel.ridden}
				<!-- On a road the horizon is the road ahead (ADR-0046 as amended,
				     #3641); the session's clock is slot 1's strip. -->
				<div class="h-full">
					<Skyline
						road={channel.ridden.road}
						m={channel.ridden.m}
						mps={channel.ridden.mps}
						strip={inFocus === 'media'}
					/>
				</div>
			{:else if !quiet && inFocus !== 'media' && channel.segments.length > 0}
				<!-- The horizon: the session is the ground the numbers stand on,
			     not another card. It gives way to the player when media has
			     the focus — two grounds is one too many — and a game's
			     session has no timeline to draw (#2597). -->
				<div class="relative min-h-28 flex-1">
					<div class="absolute inset-0">
						<IntervalGraph
							ride
							marker={!channel.youStale}
							segments={channel.segments}
							{total}
							{elapsed}
							ftp={channel.you.ftp}
							trace={channel.you.trace}
						/>
					</div>
				</div>
			{/if}
		{/snippet}
	</RidingSurface>
{/if}
