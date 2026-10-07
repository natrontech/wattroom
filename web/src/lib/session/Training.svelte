<script lang="ts">
	// The Training place — the 3 m surface (ADR-0020). Was a tab inside
	// RoomLive, then a URL of the room's own; since #2449 a voice channel's.
	//
	// A FOCUS SLOT, not a fixed layout: sprint › game › shared screen › your
	// instrument. A sprint takes the screen and gives it back, a game replaces
	// the workout, a shared screen replaces both, and the instrument is what
	// returns. The player is never overlaid — RMF — so the numbers go below it.
	import CountdownScreen from '$lib/session/CountdownScreen.svelte';
	import CrewStrip from '$lib/session/CrewStrip.svelte';
	import CrewRows from '$lib/session/CrewRows.svelte';
	import { crewOf } from '$lib/session/follow';
	import { bottleFor } from '$lib/roadside';
	import RoadsideDeck from '$lib/channel/RoadsideDeck.svelte';
	import ExecutionMeter from '$lib/session/ExecutionMeter.svelte';
	import GamePanel from '$lib/session/GamePanel.svelte';
	import Instrument from '$lib/session/Instrument.svelte';
	import RidingSurface from '$lib/session/RidingSurface.svelte';
	import FlatRoad from '$lib/world/FlatRoad.svelte';
	import { createWorldView } from '$lib/world/world-view.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import BiasTrim from '$lib/session/BiasTrim.svelte';
	import BikeComputer from '$lib/session/BikeComputer.svelte';
	import RaceRadio from '$lib/race/RaceRadio.svelte';
	import HrShare from '$lib/channel/HrShare.svelte';
	import RideHeader from '$lib/session/RideHeader.svelte';
	import RideBand from '$lib/session/RideBand.svelte';
	import MomentCard from '$lib/session/MomentCard.svelte';
	import Skyline from '$lib/ride/Skyline.svelte';
	import Users from '@lucide/svelte/icons/users';
	import { peopleFold } from '$lib/channel/people-fold.svelte';
	import { rideContext } from './ride-context';
	import MonitorUp from '@lucide/svelte/icons/monitor-up';
	import LogOut from '@lucide/svelte/icons/log-out';
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
	// The compact instrument heads your numbers here, so the computer leaves
	// the watts to it: one number, one home (#3662).
	const headed = $derived(inFocus === 'media' || inFocus === 'game' || inWorld);
	const rideWorld = () =>
		import('$lib/world/RideWorld.svelte').catch((err: unknown) => {
			console.error('world: the renderer did not load', err);
			world.fail('build-failed');
			throw err;
		});
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
	const ICON = 'btn btn-secondary h-11 w-11 p-0';
</script>

{#if channel.phase === 'lounge'}
	<TrainingLounge {targetsNote} />
{:else if channel.phase === 'countdown'}
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
	<TrainingPhone />
{:else}
	{#snippet trainerCard()}
		{#if !channel.trainer || targetsNote}<TrainerOverview compact />{/if}
	{/snippet}
	{#snippet sessionControls()}
		<SessionControls compact />
		<!-- The 3 m view, from the place the rider is on (#1667): the
		     Lounge had the only button, off the numbers, mid-interval. -->
		<!-- btn-lg, as /ride and /ramp give the same control and as
		     every neighbour in this header already is (#2161): it is
		     pressed while pedalling, which is what ux.md's 44 px is
		     about. -->
		<button
			onclick={() => channel.openTv()}
			class="btn btn-secondary btn-lg"
			aria-label="TV mode"><MonitorUp size={15} /> TV</button
		>
		{#if channel.you.inSession}
			<button onclick={leaveRide} class="btn btn-ghost btn-lg"
				><LogOut size={15} /> Leave the ride</button
			>
		{/if}
		<SessionFlag />
	{/snippet}
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
			<button
				onclick={() => (peopleFold.open = true)}
				class={ICON}
				aria-label="who is here"
				title="Who is here"><Users size={20} /></button
			>
			<SessionFlag />
			{#if channel.you.inSession}
				<!-- One short word, so the eyebrow keeps the row (slot 1's 860 px). -->
				<button
					onclick={leaveRide}
					class="btn btn-secondary btn-lg"
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
	{#snippet road()}
		{#await rideWorld() then { default: RideWorld }}
			{#if channel.ridden}
				<RideWorld
					road={channel.ridden.road}
					metre={() => channel.ridden ?? { m: 0, mps: 0 }}
					bunch={() => channel.ridden?.bunch ?? null}
					watts={channel.you.watts}
					silent={channel.youStale}
					ftp={channel.you.ftp}
					progress={total > 0 ? elapsed / total : null}
					paused={inFocus === 'media'}
					onfail={world.fail}
					onflat={world.flatten}
				/>
			{/if}
		{/await}
	{/snippet}
	<RidingSurface
		class="h-full overflow-hidden"
		world={inWorld ? road : undefined}
		stage={inFocus === 'media'}
		moment={inWorld && inFocus === 'sprint' ? moment : undefined}
		seat={docked ? nowPlaying : undefined}
	>
		{#snippet header()}
			{#if inWorld}
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
					controls={worldControls}
					status={trainerLine}
					{strip}
				/>
			{:else}
				<div class="px-6 pt-5 pb-4">
					<!-- The Flat-road reason is a status line: atop slot 1 (G3, G4). -->
					{#if channel.ridden && world.reason}
						<FlatRoad reason={world.reason} onretry={world.retry} />
					{/if}
					<RideHeader
						block={channel.block}
						{elapsed}
						{total}
						cadence={channel.you.cadence}
						hr={channel.you.hr}
						title={channel.shared?.workoutName ?? ''}
						context={rideContext(
							'Session',
							channel.shared?.workoutName ?? '',
							inRide.length,
						)}
						drives={!!channel.trainer && channel.actuating}
						aside={trainerCard}
						controls={sessionControls}
					/>
				</div>
			{/if}
			{#if channel.race}
				<div class={inWorld ? 'px-4 pb-3' : 'px-6'}>
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
			{:else if !inWorld}
				<!-- The focus row gives way first on a short window (#3611): centred
				     without the safe keyword, the Instrument overflowed it both ways,
				     up over the header, and the coach's controls stopped taking
				     clicks. Clipped to its row, and centred safely, it keeps its top
				     — the watts — and covers nothing else. -->
				<section
					class="grid min-h-0 [align-content:safe_center] overflow-y-clip px-6"
				>
					<Instrument
						watts={channel.you.watts}
						stale={channel.youStale}
						idle={channel.youUnmeasured}
						target={channel.you.target}
						ftp={channel.you.ftp}
					/>
				</section>
			{/if}
		{/snippet}

		{#snippet numbers()}
			{#if !quiet && inWorld}
				<!-- One panel: the computer with its head, the trim, and whether
				     your heart rate reaches the call (ADR-0008, #2804). -->
				<BikeComputer
					docked
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
					<BiasTrim
						ride
						bias={channel.bias}
						onBias={channel.trainer && channel.actuating
							? (step) => channel.nudgeBias(step)
							: undefined}
						hint={targetsNote ? `${targetsNote} — trim them there` : undefined}
					/>
					<HrShare />
				</div>
			{:else if !quiet}
				<!-- Your numbers (ADR-0046 slot 3), and under them whether your heart
			     rate is reaching the call — the line ADR-0008 requires (#2804). -->
				<div class="mt-4 px-6">
					<div class="flex flex-wrap items-center gap-6">
						{#if headed}
							<!-- Under the player, never over it (RMF). -->
							<div class="min-w-0 flex-1">
								<Instrument
									watts={channel.you.watts}
									stale={channel.youStale}
									idle={channel.youUnmeasured}
									target={channel.you.target}
									ftp={channel.you.ftp}
									compact
								/>
							</div>
						{/if}
						<div class="min-w-0 flex-1">
							<BikeComputer
								head={headed}
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
						</div>
						<BiasTrim
							bias={channel.bias}
							onBias={channel.trainer && channel.actuating
								? (step) => channel.nudgeBias(step)
								: undefined}
							hint={targetsNote
								? `${targetsNote} — trim them there`
								: undefined}
						/>
						<!-- The live half of the execution score (#543), alone not a
						     leaderboard (#2635); below xl only, where the people column
						     does not carry it (#2882 L6-09). Not while a screen has the
						     focus: the player's own floor (RMF) is what the width is for. -->
						{#if riding.length > 1 && inFocus !== 'media' && inFocus !== 'game'}
							<div
								class="ml-auto max-h-32 w-64 shrink-0 overflow-y-auto xl:hidden"
							>
								<ExecutionMeter riders={riding} />
							</div>
						{/if}
					</div>
					<HrShare class="mt-2" />
				</div>
			{/if}
		{/snippet}

		{#snippet crew()}
			{#if inWorld && inFocus !== 'game'}
				<!-- Beside the road the crew stays under the seat, a sprint's card
				     included (the box table): rows at the riding floor. -->
				<div class="py-2"><CrewRows riders={inRide} /></div>
			{:else if !quiet && inFocus !== 'game'}
				<!-- The crew. A group-training surface that shows only your own
			     numbers is a solo app with a chat window attached. A game's panel
			     already lists everyone; a second list of the same people is what
			     the sprint branch refuses too. -->
				<div class="mt-4">
					<CrewStrip riders={crewOf(inRide, false)} />
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
				<div class="mt-3 h-28">
					<IntervalGraph
						segments={channel.segments}
						{total}
						{elapsed}
						ftp={channel.you.ftp}
						trace={channel.you.trace}
					/>
				</div>
			{/if}
		{/snippet}
	</RidingSurface>
{/if}
