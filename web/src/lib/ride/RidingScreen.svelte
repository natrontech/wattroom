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
	import RideNarrator from '$lib/ride/RideNarrator.svelte';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import { bindRideKeys, bindShifters, type RideKey } from '$lib/ride/keys';
	import { createRideShift } from '$lib/ride/ride-shift';
	import RideControls from '$lib/ride/RideControls.svelte';
	import FreeRideBand from '$lib/ride/FreeRideBand.svelte';
	import { freeRideLabel } from '$lib/ride/free-ride.svelte';
	import { trainerChip } from '$lib/workout/block';
	import { shifterSlot } from '$lib/ble/controller-slot.svelte';
	import { roadLine } from '$lib/ride/road-readout';
	import { cleanView } from '$lib/ride/clean-view.svelte';
	import KeySheet from '$lib/ride/KeySheet.svelte';
	import { board } from '$lib/board/clips.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { FLAG_NOTICE_MS, FLAG_SAID } from '$lib/ride/flag';
	import RideStatus from '$lib/ride/RideStatus.svelte';
	import ChangeWorkout from '$lib/ride/ChangeWorkout.svelte';
	import { isOpenRoad } from '$lib/workout/ridden';
	import type { ShelfEntry } from '$lib/workout/shelf';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import Skyline from '$lib/ride/Skyline.svelte';
	import { skylineOf } from '$lib/workout/road-workout';
	import { climbView, landed } from '$lib/ride/climb-view';
	import { blocksAhead, NO_GATES } from '$lib/road/gates';
	import { untrack } from 'svelte';
	import { BikeKg } from '$lib/protocol';
	import { mapView } from '$lib/ride/map-view';
	import { toggleMap } from '$lib/session/computer-pages';
	import { askCamera, askPhoto, askViewFlip } from '$lib/world/ride-view';
	import { watchClimbCues } from '$lib/ride/climb-cues.svelte';
	import { rideContext } from '$lib/session/ride-context';
	import RidingSurface from '$lib/session/RidingSurface.svelte';
	import BiasTrim from '$lib/session/BiasTrim.svelte';
	import BikeComputer from '$lib/session/BikeComputer.svelte';
	import { createWorldView } from '$lib/world/world-view.svelte';
	import MomentCard from '$lib/session/MomentCard.svelte';
	import CountdownScreen from '$lib/session/CountdownScreen.svelte';
	import RideBand from '$lib/session/RideBand.svelte';
	import { COUNTDOWN_SECONDS } from '$lib/workout/ride-state';
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
		shelf,
		onChangeWorkout,
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
		/**
		 * Change workout (#4257): the shelf to pick from, and the page's
		 * change — `null` rides the road on with none. Absent, no control.
		 */
		shelf?: ShelfEntry[];
		onChangeWorkout?: (next: Workout | null) => void;
	} = $props();

	let changing = $state(false);
	// No workout, the road on: nothing to skip or stretch, no time left (#4257).
	const open = $derived(isOpenRoad(workout));

	// Easier / Harder from the keys and any clicker, while this ride runs
	// (#3329); with no workout, from the pair in slot 1 too (#4283). One
	// shifter for every input (ride-shift.ts).
	const shift = $derived(createRideShift(session));
	$effect(() => {
		const driver = shift;
		const unbind = gearsEnabled() ? bindShifters(driver) : undefined;
		return () => {
			unbind?.();
			driver.stop();
		};
	});

	// The ride keys (#3216). O takes the ride's picture (#4253).
	let sheet = $state(false);
	function rideKey(key: RideKey) {
		if (key.kind === 'sheet') sheet = !sheet;
		else if (key.kind === 'clean') cleanView.toggle();
		else if (key.kind === 'camera') {
			if (!askCamera(key.preset)) toasts.push('Cameras need the 3D road.');
		} else if (key.kind === 'map') {
			if (!toggleMap()) toasts.push('The MAP page needs a road.');
		} else if (key.kind === 'view') {
			if (!askViewFlip())
				toasts.push('3D needs a road and this device’s world.');
		} else if (!askPhoto()) toasts.push('Pictures need the 3D road.');
	}
	$effect(() => bindRideKeys(rideKey, (k) => !!board.onKey(k)));
	// A controller's view buttons are the same keys (#3335); its camera
	// button steps through the four, as the phone remote's does (#4253).
	$effect(() =>
		shifterSlot.onAction((action, edge) => {
			if (edge !== 'down') return;
			if (action === 'camera') {
				if (!askCamera()) toasts.push('Cameras need the 3D road.');
			} else if (action === 'clean' || action === 'map' || action === 'snap')
				rideKey({ kind: action });
		}),
	);

	// The ⚑'s own acknowledgement (#52), and nothing outside this screen ever
	// asks about it.
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
	// A phone's band is slot 2's place in its own column, not a dock (#3676).
	const drawn = $derived((world.on || world.band) && !!session.road);
	const skyline = $derived(skylineOf(session.road, session.segments, ftp));
	// The next blocks on the road (#3101): ridden ahead from the dot at your
	// own target on your own weight, as the dot moves; a road workout's at its pins.
	const ahead = $derived.by(() => {
		const on = session.road;
		// Ridden ahead up the road only: riding back (#4261) paints none.
		if (!on || on.reverse) return null;
		return blocksAhead(
			{
				segments: session.segments,
				// Read as the dot moves, never as the clock ticks: the two run on
				// their own phases, and pairing a new second with an old metre slid
				// every gate a second of road back and forth.
				t: untrack(() => session.elapsed),
				m: on.along,
				mps: on.mps,
				road: on.road,
				loop: on.loop,
				pacer: { ftp, bias: session.bias, kg: kg + BikeKg },
				...(on.blockEndsM && {
					pins: { fromM: on.startM, stepEndM: on.blockEndsM },
				}),
			},
			workout,
			{ ftp, bias: session.bias },
		);
	});
	// The climb card on a road (#3645): CLIMB opens by itself, and says so.
	const climb = $derived(landed(climbView(skyline), ahead?.lands));
	const map = $derived(mapView(skyline));
	watchClimbCues(() => climb);

	// The HUD feed (ADR-0041): what this screen shows, once a second, for a
	// second window to mirror — the shell's overlay, or another tab.
</script>

<RideNarrator
	view={skyline}
	{watts}
	{ftp}
	stale={signalLost}
	{block}
	sprintStartsAt={session.sprint?.startsAtMs ?? null}
/>

{#snippet worldControls()}
	<RideControls
		{session}
		{open}
		{shift}
		{world}
		{drawn}
		{countIn}
		onflag={onFlag ? flag : undefined}
		ontv={onTv}
		onchange={shelf && onChangeWorkout ? () => (changing = true) : undefined}
	/>
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

{#snippet road()}
	{#await world.load() then { default: RideWorld }}
		{#if session.road}
			{@const on = session.road}
			<RideWorld
				road={on.road}
				loop={on.loop}
				metre={() => ({
					m: session.road?.along ?? on.along,
					mps: session.road?.mps ?? 0,
					reverse: session.road?.reverse ?? on.reverse,
				})}
				{watts}
				silent={signalLost}
				{ftp}
				progress={session.total > 0 ? session.elapsed / session.total : null}
				look={world.look}
				countIn={countIn
					? { left: countIn.remaining, total: COUNTDOWN_SECONDS }
					: null}
				gates={() => ahead?.gates ?? NO_GATES}
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
			<button onclick={countIn.cancel} class="btn btn-secondary btn-ride"
				>Cancel</button
			>
		{/snippet}
	</CountdownScreen>
{:else}
	<RidingSurface
		clean={inWorld && cleanView.on && !signalLost && !noCrashSafety}
		onshow={cleanView.toggle}
		cleanLine={block?.road ? roadLine(block.road) : undefined}
		class="flex-1 {inWorld ? '-mx-4 -my-5 sm:-mx-6' : 'pb-16 sm:pb-0'}"
		world={drawn ? road : undefined}
		moment={inWorld && session.sprint ? moment : undefined}
		centre={countIn ? digit : undefined}
		dockIn={!!countIn}
		headerFit={!skyline}
	>
		{#snippet header()}
			{#if open && session.road}
				<!-- No workout, the road on: the free ride's own slot 1 on that
				     road (TARGETS ride-free-road 3 and 7, #4283). -->
				<FreeRideBand
					label={freeRideLabel(session.road)}
					roadLine={roadLine(session.road.readout)}
					chip={block ? trainerChip(block) : undefined}
					seconds={session.elapsed}
					climbed={session.road.climbed}
					status={rideStatus}
					actions={worldControls}
				/>
			{:else}
				<!-- The strip only beside a Skyline: without a road the graph below is
				     the workout's one picture, its blocks in words (#4159). -->
				<RideBand
					{block}
					elapsed={session.elapsed}
					total={session.total}
					title={workout.name}
					context={rideContext('Solo', workout.name)}
					drives
					wide={!inWorld}
					hint={session.road?.pinned
						? 'The road decides where a block ends.'
						: undefined}
					controls={worldControls}
					status={rideStatus}
					strip={skyline ? strip : undefined}
				/>
			{/if}
		{/snippet}

		{#snippet focus()}
			<!-- On the road the world has the focus; flat, only a sprint takes it,
			     as its moment card, and the head under it keeps the one watts figure. -->
			{#if !inWorld && session.sprint}
				<div class="p-4">{@render moment()}</div>
			{/if}
		{/snippet}

		{#snippet numbers()}
			<!-- One panel: the computer with its head, then the trim it trims.
			     The dot's speed is RIDE's (one home); km and grade are slot 1's. -->
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
				{map}
				gear={open && gearsEnabled() ? session.gear.label : undefined}
			/>
			<!-- No workout, no target to trim (#4257). -->
			{#if !open}<div class="px-4 pb-3">
					<BiasTrim
						ride
						bias={session.bias}
						onBias={(step) => session.nudgeBias(step)}
					/>
				</div>{/if}
			{#if flagNotice}
				<!-- Consent in plain words, at the moment of the tap, never blocking. -->
				<p class="text-muted px-4 pb-3 text-xs">{FLAG_SAID.after}</p>
			{/if}
		{/snippet}

		{#snippet horizon()}
			{#if skyline}
				<!-- On a road the horizon is the road ahead (ADR-0046 as amended,
			     #3641): the Skyline, with the blocks along it. -->
				{#if inWorld}
					<div class="h-full"><Skyline {...skyline} /></div>
				{:else}
					<div class="relative min-h-40 flex-1">
						<div class="absolute inset-0"><Skyline {...skyline} /></div>
					</div>
				{/if}
			{:else}
				<div class="relative min-h-28 flex-1">
					<div class="absolute inset-0">
						<IntervalGraph
							ride
							words={{ bias: session.bias }}
							marker={!signalLost}
							segments={session.segments}
							total={session.total}
							elapsed={session.elapsed}
							{ftp}
							trace={session.trace}
						/>
					</div>
				</div>
			{/if}
		{/snippet}
	</RidingSurface>
{/if}

{#if sheet}<KeySheet onclose={() => (sheet = false)} />{/if}
{#if changing && shelf && onChangeWorkout}
	<ChangeWorkout
		{shelf}
		current={workout.name}
		onRoad={!!session.road}
		onpick={(next) => {
			changing = false;
			onChangeWorkout(next);
		}}
		onclose={() => (changing = false)}
	/>
{/if}

{#snippet moment()}
	{#if session.sprint}<MomentCard sprint={session.sprint} />{/if}
{/snippet}
