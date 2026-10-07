<script lang="ts">
	/**
	 * The ride itself (#1057): what you are holding, how far in, and the handful
	 * of controls a rider can hit at arm's length without looking.
	 *
	 * The other half of the two screens this page was. Like `PreRide`, it owns
	 * no ride state — the page keeps the session, because ending it, saving it
	 * and the summary all belong to the page. The one thing this DOES own is
	 * the flag notice, which is four seconds of its own chrome and nothing
	 * else's business.
	 *
	 * ADR-0046: the slots below are a voice channel's Training place, in the
	 * same order, minus the crew. Which block this is, how long is left, what
	 * is coming next, rpm and bpm at a size that survives three metres — all of
	 * it comes from the components a session draws, because a rider alone
	 * deserves the screen a rider in a session gets.
	 */
	import FlagButton from '$lib/ride/FlagButton.svelte';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import { bindRideShift } from '$lib/ride/keys';
	import { confirm } from '$lib/confirm.svelte';
	import { FLAG_NOTICE_MS, FLAG_SAID } from '$lib/ride/flag';
	import RideStatus from '$lib/ride/RideStatus.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import Skyline from '$lib/ride/Skyline.svelte';
	import { skylineOf } from '$lib/workout/road-workout';
	import { climbView } from '$lib/ride/climb-view';
	import { watchClimbCues } from '$lib/ride/climb-cues.svelte';
	import Instrument from '$lib/session/Instrument.svelte';
	import RideHeader from '$lib/session/RideHeader.svelte';
	import { rideContext } from '$lib/session/ride-context';
	import RidingSurface from '$lib/session/RidingSurface.svelte';
	import BiasTrim from '$lib/session/BiasTrim.svelte';
	import BikeComputer from '$lib/session/BikeComputer.svelte';
	import FlatRoad from '$lib/world/FlatRoad.svelte';
	import { createWorldView } from '$lib/world/world-view.svelte';
	import SprintMoment from '$lib/session/SprintMoment.svelte';
	import MomentCard from '$lib/session/MomentCard.svelte';
	import CountdownScreen from '$lib/session/CountdownScreen.svelte';
	import RideBand from '$lib/session/RideBand.svelte';
	import MonitorUp from '@lucide/svelte/icons/monitor-up';
	import AlarmClockPlus from '@lucide/svelte/icons/alarm-clock-plus';
	import SkipForward from '@lucide/svelte/icons/skip-forward';
	import type { Block } from '$lib/workout/block';
	import type { createRideSession } from '$lib/workout/session.svelte';
	import type { Workout } from '$lib/workout/types';

	let {
		session,
		block,
		workout,
		ftp,
		kg,
		lthr,
		watts,
		target,
		signalLost,
		noCrashSafety = false,
		onFlag,
		onTv,
		countIn,
	}: {
		session: ReturnType<typeof createRideSession>;
		/** Where you are in the work, from the page — the TV draws the same one. */
		block: Block | null;
		workout: Workout;
		ftp: number;
		/** For w/kg — the stat every rider in a session carries and this one did not. */
		kg: number;
		/** Yours, for your own bpm's zone colour (ADR-0014). */
		lthr?: number;
		watts: number;
		target: number;
		signalLost: boolean;
		/** Nothing is writing this ride down (#1466) — RideStatus says so. */
		noCrashSafety?: boolean;
		/** Absent where the page has its own ⚑ and TV — a voice channel's (#2329). */
		onFlag?: () => void;
		onTv?: () => void;
		/**
		 * The count-in (#1800): seconds left and the way out. Flat, the one
		 * digit; over the world the slots stand in place already, and the
		 * digit is the only thing in the corridor (TARGETS ride-countin).
		 */
		countIn?: { remaining: number; cancel: () => void };
	} = $props();

	// The ⚑'s own acknowledgement (#52), and nothing outside this screen ever
	// asks about it.
	// End sits in the cluster with TV and Skip block, 44 px each, and a ride
	// it ends cannot be resumed — one stray thumb filed a truncated ride
	// (#2623). It asks, the way a session's End always has (errors.md).
	async function endRide() {
		const ok = await confirm({
			title: 'End the ride?',
			body: 'The rest of the workout cannot be resumed. What you have ridden is saved if it is a minute or longer.',
			action: 'End the ride',
			cancel: 'Keep riding',
		});
		if (ok) session.stop();
	}

	// Easier / Harder from the keys and any clicker, while this ride runs (#3329).
	$effect(() => (gearsEnabled() ? bindRideShift(session) : undefined));

	/** A 44 px icon control mid-ride (ux.md), skinned as SessionControls' are. */
	const ICON = 'btn btn-secondary h-11 w-11 p-0';

	let flagNotice = $state(false);
	function flag() {
		onFlag?.();
		flagNotice = true;
		setTimeout(() => (flagNotice = false), FLAG_NOTICE_MS);
	}

	// The world in slot 2, where this device has it on (#3031) and the ride
	// carries a road (ADR-0066: a ride with no road keeps its surface, #3663):
	// three.js comes in its own chunk, and a world that cannot draw, or stops,
	// hands the ride to the Skyline in slot 5 until the rider asks for 3D
	// again (#3080).
	const world = createWorldView();
	const inWorld = $derived(world.on && !!session.road);
	const skyline = $derived(skylineOf(session.road, session.segments, ftp));
	// The climb card on a road (#3645): CLIMB opens by itself, and says so.
	const climb = $derived(climbView(skyline));
	watchClimbCues(() => climb);
	const rideWorld = () =>
		import('$lib/world/RideWorld.svelte').catch((err: unknown) => {
			console.error('world: the renderer did not load', err);
			world.fail('build-failed');
			throw err;
		});

	// The HUD feed (ADR-0041): what this screen shows, once a second, for a
	// second window to mirror — the shell's overlay, or another tab.
</script>

{#snippet worldControls()}
	<!-- Over the world, one row in slot 1 (TARGETS ride-road-world 7): ⚑,
	     TV, +1 min and Skip block as 44 px icons, named and with tooltips;
	     End ride the one word. A road workout's blocks end at their metres
	     (#3499), so it shows neither +1 min nor Skip (D13). -->
	{@const last = session.info.segmentIndex + 1 >= session.segments.length}
	<div class="flex items-center gap-2">
		{#if countIn}
			<!-- Nothing runs yet: the one way out. -->
			<button
				onclick={countIn.cancel}
				class="btn btn-secondary h-11 px-4 text-2xl">Cancel</button
			>
		{:else}
			{#if onFlag}<FlagButton onflag={flag} sends="after" />{/if}
			{#if onTv}
				<button onclick={onTv} class={ICON} aria-label="TV mode" title="TV mode"
					><MonitorUp size={20} /></button
				>
			{/if}
			{#if !session.road?.pinned}
				<button
					onclick={() => session.extend(60)}
					class={ICON}
					aria-label="One more minute"
					title="+1 min"><AlarmClockPlus size={20} /></button
				>
				<button
					onclick={() => session.skip()}
					disabled={last}
					class={ICON}
					aria-label="Skip block"
					title={last ? 'Last block — End ride instead' : 'Skip block'}
					><SkipForward size={20} /></button
				>
			{/if}
			<button onclick={endRide} class="btn btn-secondary h-11 px-4 text-2xl"
				>End ride</button
			>
		{/if}
	</div>
{/snippet}

{#snippet digit()}
	<!-- A count to the start, not a reading: ink, no glow (G2). -->
	<p class="sr-only" role="status">Starting {workout.name} in a moment</p>
	<span
		aria-hidden="true"
		data-testid="count-in"
		class="font-display text-ink text-[9rem] leading-none font-bold tabular-nums"
		>{countIn?.remaining}</span
	>
{/snippet}

{#snippet rideStatus()}
	<RideStatus {session} {signalLost} {noCrashSafety} line />
{/snippet}

{#snippet strip()}
	<IntervalGraph
		segments={session.segments}
		total={session.total}
		elapsed={session.elapsed}
		{ftp}
		trace={session.trace}
		compact
		marker={false}
	/>
{/snippet}

<!-- The bottom padding is the floating navigation button's (ux.md: the last
     item clears the chrome); on a desk there is no such button. The slots are
     a session's (ADR-0046), minus the crew. -->
{#snippet rideControls()}
	<!-- Rider controls: big targets, no precision needed (ux.md). The
		     session's coach controls sit in this same slot; the bias trim is not
		     here, because it belongs with the numbers it trims. -->
	<!-- Wraps rather than shrinking (#1634): at 375 px the cluster ran 39
		     px past the viewport and the ⚑ — the last button — could not be
		     reached at all. -->
	<div class="flex flex-wrap items-center justify-end gap-2">
		<!-- The kit's riding size (ux.md: btn-lg is the 44 px a rider hits
			     while pedalling); these used to retype the chrome by hand. -->
		<!-- A road workout's blocks end at their metres (#3499): nothing to
		     skip or hold longer, and the reason said where they were. -->
		{#if session.road?.pinned}
			<span class="text-muted text-xs"
				>The road decides where a block ends.</span
			>
		{:else}
			<button
				onclick={() => session.extend(60)}
				class="btn btn-secondary btn-lg">+1 min</button
			>
			<!-- Nothing to skip to on the last block: disabled with the
				     reason, never a click that does nothing (ux.md, #1799). -->
			<button
				onclick={() => session.skip()}
				disabled={session.info.segmentIndex + 1 >= session.segments.length}
				title={session.info.segmentIndex + 1 >= session.segments.length
					? 'Last block — End ride instead'
					: undefined}
				class="btn btn-secondary btn-lg disabled:opacity-40">Skip block</button
			>
		{/if}
		{#if onTv}
			<button onclick={onTv} class="btn btn-secondary btn-lg">TV</button>
		{/if}
		<button onclick={endRide} class="btn btn-secondary btn-lg">End ride</button>
		{#if onFlag}
			<FlagButton onflag={flag} sends="after" />
		{/if}
	</div>
{/snippet}

{#snippet road()}
	{#await rideWorld() then { default: RideWorld }}
		{#if session.road}
			{@const on = session.road}
			<RideWorld
				road={on.road}
				metre={() => ({
					m: session.road?.along ?? on.along,
					mps: session.road?.mps ?? 0,
				})}
				{watts}
				silent={signalLost}
				{ftp}
				progress={session.total > 0 ? session.elapsed / session.total : null}
				onfail={world.fail}
				onflat={world.flatten}
			/>
		{/if}
	{/await}
{/snippet}

<!-- Over the world it fills the page edge to edge (TARGETS ride-road-world
     2): the page's own padding is undone here, where the world is known. -->
{#if countIn && !inWorld}
	<!-- Sound AND visual (.claude/rules/ux.md): the cue alone reaches a
	     rider who is climbing back onto the bike, not the one still walking
	     to it. A session's own count-in screen (ADR-0046). -->
	<CountdownScreen
		remaining={countIn.remaining}
		title={workout.name}
		note={block
			? `first up · ${block.label}${block.watts > 0 ? ` ${block.watts} W` : ''}`
			: undefined}
	>
		{#snippet controls()}
			<button onclick={countIn.cancel} class="btn btn-secondary btn-lg"
				>Cancel</button
			>
		{/snippet}
	</CountdownScreen>
{:else}
	<RidingSurface
		class="flex-1 {inWorld ? '-mx-4 -my-5 sm:-mx-6' : 'pb-16 sm:pb-0'}"
		world={inWorld ? road : undefined}
		moment={inWorld && session.sprint ? moment : undefined}
		centre={countIn ? digit : undefined}
	>
		{#snippet header()}
			{#if inWorld}
				<RideBand
					{block}
					elapsed={session.elapsed}
					total={session.total}
					title={workout.name}
					context={rideContext('Solo', workout.name)}
					drives
					hint={session.road?.pinned
						? 'The road decides where a block ends.'
						: undefined}
					controls={worldControls}
					status={rideStatus}
					{strip}
				/>
			{:else}
				<!-- Ride-critical states are persistent status, never toasts
				     (.claude/rules/errors.md), and one line atop slot 1 (G3,
				     ride-status 1); the way back from a dropout is its own button,
				     wired to this ride's trainer (#1847). The Flat-road reason is
				     a status line too (G4). -->
				<RideStatus {session} {signalLost} {noCrashSafety} line />
				{#if session.road && world.reason}
					<FlatRoad reason={world.reason} onretry={world.retry} />
				{/if}
				<RideHeader
					{block}
					elapsed={session.elapsed}
					total={session.total}
					cadence={session.sample?.cadence ?? 0}
					hr={session.sample?.heartRate ?? 0}
					title={workout.name}
					context={rideContext('Solo', workout.name)}
					drives
					controls={rideControls}
				/>
			{/if}
		{/snippet}

		{#snippet focus()}
			<!-- The focus slot takes the free height rather than sitting under the
		     header with a screen of nothing below it (#1531: "two thirds empty").
		     On the road the world has the focus, and a sprint is its moment card. -->
			{#if !inWorld}
				<!-- Clipped to its row and centred safely on a short window (#3611):
			     overflowing, it used to cover the header's controls. -->
				<section
					class="grid min-h-0 [align-content:safe_center] overflow-y-clip"
				>
					{#if session.sprint}
						<!-- A sprint block takes the focus, solo as in a session (#1793,
				     ADR-0046): the count-in, the window and your watts, where the
				     instrument used to read "no target — spin easy" for fifteen
				     seconds of all-out. No roster: nobody else is here. -->
						<SprintMoment sprint={session.sprint} myWatts={watts} />
					{:else}
						<Instrument {watts} {target} {ftp} stale={signalLost} />
					{/if}
				</section>
			{/if}
		{/snippet}

		{#snippet numbers()}
			{#if inWorld}
				<!-- One panel: the computer with its head, then the trim it trims. -->
				<!-- The dot's speed is RIDE's (one home); km and grade are slot 1's. -->
				<BikeComputer
					docked
					roadLine
					road={session.road
						? {
								speedKph: session.road.mps * 3.6,
								km: session.road.m / 1000,
								ofKm: session.road.toM / 1000,
							}
						: undefined}
					{ftp}
					cadence={session.sample?.cadence ?? 0}
					stale={signalLost}
					hr={session.sample?.heartRate ?? 0}
					{watts}
					{kg}
					{lthr}
					execution={session.scored ? session.execution : undefined}
					target={target > 0 ? target : undefined}
					stats={session.live}
					{climb}
				/>
				<div class="px-4 pb-3">
					<BiasTrim
						ride
						bias={session.bias}
						onBias={(step) => session.nudgeBias(step)}
					/>
				</div>
			{:else}
				<div class="flex flex-wrap items-end gap-4">
					<div class="min-w-0 flex-1">
						<!-- The big instrument holds the watts, so RIDE leaves them
						     (D17); the flat layout itself is #3670's. -->
						<BikeComputer
							head={!session.sprint}
							cadence={session.sample?.cadence ?? 0}
							stale={signalLost}
							hr={session.sample?.heartRate ?? 0}
							{watts}
							{kg}
							{lthr}
							execution={session.scored ? session.execution : undefined}
							target={target > 0 ? target : undefined}
							stats={session.live}
						/>
					</div>
					<BiasTrim
						bias={session.bias}
						onBias={(step) => session.nudgeBias(step)}
					/>
				</div>
			{/if}
			{#if flagNotice}
				<!-- Consent in plain words, at the moment of the tap, never blocking. -->
				<p class="text-muted mt-2 text-xs {inWorld ? 'px-4 pb-3' : ''}">
					{FLAG_SAID.after}
				</p>
			{/if}
		{/snippet}

		{#snippet horizon()}
			{#if skyline}
				<!-- On a road the horizon is the road ahead (ADR-0046 as amended,
			     #3641): the Skyline, with the blocks along it. -->
				<div class={inWorld ? 'h-full' : 'mt-4 h-40 shrink-0'}>
					<Skyline {...skyline} />
				</div>
			{:else}
				<div class="mt-4 h-28 shrink-0">
					<IntervalGraph
						segments={session.segments}
						total={session.total}
						elapsed={session.elapsed}
						{ftp}
						trace={session.trace}
					/>
				</div>
			{/if}
		{/snippet}
	</RidingSurface>
{/if}

{#snippet moment()}
	{#if session.sprint}<MomentCard sprint={session.sprint} />{/if}
{/snippet}
