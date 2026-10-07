<script lang="ts">
	/**
	 * A free ride, riding (ADR-0059, #3669): ADR-0046's riding surface with no
	 * workout, drawn once for the road ride at /ride?road= and for a voice
	 * channel's free ride. Slot 1 is the road line, the trainer chip and the
	 * clock, with the rider's own controls in its row where a workout's
	 * transport sits; your numbers are the bike computer with its head, the
	 * one watts figure (TARGETS D17); the world is slot 2 where this device
	 * draws it (ADR-0066), the Skyline slot 5. What rides — the trainer, the
	 * gear, the samples — is the caller's; this owns no ride state.
	 */
	import { untrack, type Snippet } from 'svelte';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import { faultCopy } from '$lib/channel/fault-copy';
	import { formatClock } from '$lib/format';
	import { climbedM } from '$lib/ride/climbed';
	import type { Clamp } from '$lib/ride/drivetrain';
	import { GRADE, WATTS, type FreeMode } from '$lib/ride/free-ride-controls';
	import { freeRideLabel, type FreeRide } from '$lib/ride/free-ride.svelte';
	import GearShift from '$lib/ride/GearShift.svelte';
	import { ONE_GEAR_LINE } from '$lib/ride/mode-copy';
	import type { RideShift } from '$lib/ride/ride-shift';
	import { roadLine } from '$lib/ride/road-readout';
	import { endRideLabel, roadEndOffered } from '$lib/ride/road-end';
	import RoadEnd from '$lib/ride/RoadEnd.svelte';
	import Skyline from '$lib/ride/Skyline.svelte';
	import BikeComputer from '$lib/session/BikeComputer.svelte';
	import { roadContext } from '$lib/session/computer-pages';
	import RidingSurface from '$lib/session/RidingSurface.svelte';
	import FlatRoad from '$lib/world/FlatRoad.svelte';
	import { JUMP_M } from '$lib/world/sim';
	import { createWorldView } from '$lib/world/world-view.svelte';

	let {
		free,
		watts,
		cadence,
		hr,
		kg,
		lthr,
		ftp,
		stale = false,
		idle = false,
		gear,
		shift,
		shiftOff = null,
		resetAt = 0,
		cassette = true,
		split,
		onend,
		ending = false,
		controls,
		setup,
		foot,
		worldClass = '',
		class: extra = '',
	}: {
		free: FreeRide;
		watts: number;
		cadence: number;
		hr: number;
		kg: number;
		lthr?: number;
		ftp: number;
		/** The trainer went quiet (#2851): nothing keeps its watt or glow. */
		stale?: boolean;
		/** Nothing paired that could measure (#2941). */
		idle?: boolean;
		/** The gear, where gears are on (ADR-0084); Easier and Harder need `shift`. */
		gear?: { label: string; clamp: Clamp };
		shift?: Pick<RideShift, 'press' | 'release' | 'drop'>;
		shiftOff?: string | null;
		resetAt?: number;
		cassette?: boolean;
		/** Your ghost's split (ADR-0068). */
		split?: { seconds: number; best: boolean };
		/** End ride; absent while there is nothing to end. */
		onend?: () => void;
		ending?: boolean;
		/** The caller's own controls in slot 1's row, before End ride. */
		controls?: Snippet;
		/** What the flat surface shows above the numbers before the first stroke. */
		setup?: Snippet;
		/** Under the numbers on the flat surface — the channel's consent line. */
		foot?: Snippet;
		/** Undoes the page's gutters so the world fills the frame (TARGETS ride-road-world 2). */
		worldClass?: string;
		class?: string;
	} = $props();

	const road = $derived(free.road);
	const inWatts = $derived(free.mode === 'watts');
	// The world in slot 2 where this device has it on and the ride has a
	// road (ADR-0066); a world that cannot draw hands the ride to the Skyline.
	const world = createWorldView();
	const inWorld = $derived(world.on && !!road);

	const modes: { id: FreeMode; label: string }[] = $derived([
		{ id: 'grade', label: road ? 'Road' : 'Grade' },
		{ id: 'watts', label: 'Watts' },
	]);
	// Off a road the rider sets the slope or the watts (ADR-0059); on one the
	// road does (#3027), and the chip says how the trainer rides it.
	const value = $derived(
		inWatts ? `${free.watts} W` : `${free.grade.toFixed(1)} %`,
	);
	const atMin = $derived(
		inWatts ? free.watts === WATTS.min : free.grade === GRADE.min,
	);
	const atMax = $derived(
		inWatts ? free.watts === WATTS.max : free.grade === GRADE.max,
	);
	const chip = $derived(
		!road
			? null
			: inWatts
				? `Watts · ${free.targetWatts} W`
				: `SIM · you feel ${road.felt.toFixed(1)} %`,
	);
	// ponytail: the trainer reattaches by itself for as long as the page lives
	// (#37), so the line has no button; one when a ride needs the chooser here.
	const fault = $derived(
		stale && !idle
			? faultCopy({ kind: 'trainer', state: 'silent' }).line
			: null,
	);
	const hint = $derived(!inWatts && !cassette ? ONE_GEAR_LINE : undefined);

	// Metres climbed this ride (TARGETS ride-free-road 3): the rises between
	// one second's metre and the next; a jump is a lap turned, not a climb.
	let climbed = $state(0);
	let lastM: number | null = null;
	$effect(() => {
		const at = road ? { profile: road.profile, m: road.m } : null;
		const recording = free.recording;
		untrack(() => {
			if (!recording || !at) {
				climbed = 0;
				lastM = null;
				return;
			}
			if (lastM !== null && Math.abs(at.m - lastM) <= JUMP_M)
				climbed += climbedM(at.profile, lastM, at.m);
			lastM = at.m;
		});
	});

	const WORDS = 'text-2xl leading-6';
	const CHIP = `${WORDS} border-neon/40 text-muted rounded border px-2 whitespace-nowrap`;
</script>

{#snippet band()}
	<!-- Four rows, so the road's name is never cut for the controls: the
	     label, the road line, the chip row, then the controls — 176 px at
	     SPEC's sizes, above the corridor (the box table's 200). -->
	<header data-testid="ride-band" class="flex flex-col gap-2 px-4 py-2">
		{#if fault}
			<!-- Ride-critical status is slot 1's first line (G3), never a toast. -->
			<div
				data-status-line
				role="alert"
				class="flex min-w-0 items-center gap-4"
			>
				<span class="bg-danger size-2.5 shrink-0 rounded-full"></span>
				<p class="min-w-0 truncate {WORDS}">{fault}</p>
			</div>
		{:else}
			<p data-testid="ride-context" class="ride-label truncate">
				{freeRideLabel(road)}
			</p>
		{/if}
		{#if road}
			<!-- Where on the road, once (TARGETS one home: slot 1's road line). -->
			<p data-testid="block-road" class="num text-4xl leading-none font-bold">
				{roadLine(road.readout)}
			</p>
		{/if}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 {WORDS}">
			{#if chip}<span data-testid="trainer-chip" class={CHIP}>{chip}</span>{/if}
			<p data-testid="ride-clock" class="num text-muted">
				{formatClock(
					free.seconds,
				)}{#if road}{` · ${Math.round(climbed)} m climbed`}{/if}
			</p>
			{#if hint}<p class="text-muted truncate">{hint}</p>{/if}
			{#if road && world.reason}
				<FlatRoad reason={world.reason} onretry={world.retry} />
			{/if}
		</div>
		<!-- One row of 44 px controls (ux.md, TARGETS ride-free-road 7); it
		     wraps rather than clipping, as every control row does (#1634). -->
		<div class="flex min-w-0 flex-wrap items-center gap-2">
			<!-- No frame of its own: the pressed button is the group's mark, and
			     a framed group is 10 px the band cannot spend above the corridor. -->
			<div class="flex gap-1" role="group" aria-label="what you set">
				{#each modes as mode (mode.id)}
					<button
						onclick={() => free.setMode(mode.id)}
						aria-pressed={free.mode === mode.id}
						class="btn btn-lg {free.mode === mode.id
							? 'btn-secondary'
							: 'btn-ghost'}">{mode.label}</button
					>
				{/each}
			</div>
			{#if !road}
				<button
					onclick={() => free.nudge(-1)}
					disabled={atMin}
					class="btn btn-secondary btn-lg"
					aria-label={inWatts ? 'fewer watts' : 'lower grade'}
					><Minus size={18} /></button
				>
				<span class="num w-24 text-center text-3xl font-bold" aria-live="polite"
					>{value}</span
				>
				<button
					onclick={() => free.nudge(1)}
					disabled={atMax}
					class="btn btn-secondary btn-lg"
					aria-label={inWatts ? 'more watts' : 'steeper grade'}
					><Plus size={18} /></button
				>
			{/if}
			{#if gear && shift && !inWatts}
				<GearShift row {shift} {gear} off={shiftOff} {resetAt} {cassette} />
			{/if}
			{@render controls?.()}
			{#if onend}
				<button
					onclick={onend}
					disabled={ending}
					class="btn btn-secondary btn-lg">{endRideLabel(free)}</button
				>
			{/if}
		</div>
	</header>
{/snippet}

{#snippet computer()}
	<!-- The dot's speed is RIDE's (one home); km and grade are slot 1's. -->
	<BikeComputer
		docked
		roadLine
		{ftp}
		{watts}
		{cadence}
		{hr}
		{kg}
		{lthr}
		stale={stale || idle}
		stats={free.live}
		{...road && roadContext(road)}
		{split}
		gear={gear && !inWatts ? gear.label : undefined}
	/>
{/snippet}

{#snippet skyline(on: NonNullable<typeof road>)}
	<!-- The horizon on a road (#3059): the road ahead and your dot. -->
	<Skyline
		road={on.profile}
		m={on.m}
		mps={on.virtualMps}
		reverse={on.reverse}
	/>
{/snippet}

{#snippet worldSlot()}
	{#await world.load() then { default: RideWorld }}
		{#if road}
			{@const on = road}
			<RideWorld
				road={on.profile}
				metre={() => ({ m: road?.m ?? on.m, mps: road?.virtualMps ?? 0 })}
				{watts}
				silent={stale}
				{ftp}
				progress={null}
				onfail={world.fail}
				onflat={world.flatten}
			/>
		{/if}
	{/await}
{/snippet}

{#snippet roadEnd()}
	<RoadEnd {free} onsave={() => onend?.()} />
{/snippet}

<RidingSurface
	class="flex-1 {inWorld ? worldClass : ''} {extra}"
	world={inWorld ? worldSlot : undefined}
	moment={inWorld && roadEndOffered(free, false) ? roadEnd : undefined}
>
	{#snippet header()}
		{#if inWorld}
			{@render band()}
		{:else}
			<div class="ride-panel">{@render band()}</div>
		{/if}
	{/snippet}

	{#snippet focus()}
		{#if !inWorld}
			<!-- Flat, in slot order: the numbers, then the road ahead taking the
			     free height so the Skyline is on screen (TARGETS ride-free-road 9). -->
			<div class="flex min-h-0 flex-col gap-3 pt-3">
				{#if setup && !free.recording}{@render setup()}{/if}
				{#if roadEndOffered(free, false)}
					<div class="ride-panel">{@render roadEnd()}</div>
				{/if}
				<div class="ride-panel">
					{@render computer()}
					{@render foot?.()}
				</div>
				{#if road}
					<div class="ride-panel min-h-40 flex-1 overflow-hidden">
						{@render skyline(road)}
					</div>
				{/if}
			</div>
		{/if}
	{/snippet}

	{#snippet numbers()}
		{#if inWorld}{@render computer()}{/if}
	{/snippet}

	{#snippet horizon()}
		{#if inWorld && road}
			<div class="h-full">{@render skyline(road)}</div>
		{/if}
	{/snippet}
</RidingSurface>
