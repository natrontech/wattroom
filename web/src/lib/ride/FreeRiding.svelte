<script lang="ts">
	import { board } from '$lib/board/clips.svelte';
	import { bindViewKeys } from '$lib/ride/keys';
	/**
	 * A free ride, riding (ADR-0059, #3669): ADR-0046's riding surface with no
	 * workout, drawn once for the road ride at /ride?road= and for a voice
	 * channel's free ride. Slot 1 is the road line, the trainer chip and the
	 * clock; your numbers are the bike computer with its head, the one watts
	 * figure (TARGETS D17); the world is the ground where this device draws
	 * it (ADR-0066), else the Skyline. The rider's controls ride in the now
	 * bar. What rides — the trainer, the gear, the samples — is the caller's;
	 * this owns no ride state.
	 */
	import { untrack, type Snippet } from 'svelte';
	import Minus from '@lucide/svelte/icons/minus';
	import MonitorUp from '@lucide/svelte/icons/monitor-up';
	import Plus from '@lucide/svelte/icons/plus';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { openMenu } from '$lib/context-menu.svelte';
	import { createPairAgain } from '$lib/ble/pair-again.svelte';
	import type { Trainer } from '$lib/ble/trainer';
	import { formatClock } from '$lib/format';
	import { countClimbed } from '$lib/ride/climbed-count.svelte';
	import type { Clamp } from '$lib/ride/drivetrain';
	import { FLAG_NOTICE_MS, FLAG_SAID } from '$lib/ride/flag';
	import FlagButton from '$lib/ride/FlagButton.svelte';
	import RideRail from '$lib/session/RideRail.svelte';
	import ModeSwitch from '$lib/ride/ModeSwitch.svelte';
	import {
		GRADE,
		RAMP,
		WATTS,
		type RampKind,
	} from '$lib/ride/free-ride-controls';
	import { freeRideLabel, type FreeRide } from '$lib/ride/free-ride.svelte';
	import GearShift from '$lib/ride/GearShift.svelte';
	import { EASIER_HARDER_OFF } from '$lib/ride/easier-harder';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import { gearsNews } from '$lib/ride/gears-news';
	import type { GhostSplit } from '$lib/ride/ghost-split.svelte';
	import type { Pacer } from '$lib/ride/pacer.svelte';
	import { PACER_CATEGORIES, PACER_PAR } from '$lib/road/pacer';
	import type { RideShift } from '$lib/ride/ride-shift';
	import { roadEndOffered } from '$lib/ride/road-end';
	import { trainerLine } from '$lib/ride/status-lines';
	import RoadEnd from '$lib/ride/RoadEnd.svelte';
	import RideNarrator from '$lib/ride/RideNarrator.svelte';
	import Skyline from '$lib/ride/Skyline.svelte';
	import { climbView, raced } from '$lib/ride/climb-view';
	import { EVEREST_M } from '$lib/ride/climb-repeats';
	import { play } from '$lib/sound/cues';
	import { mapView } from '$lib/ride/map-view';
	import { watchClimbCues } from '$lib/ride/climb-cues.svelte';
	import BikeComputer from '$lib/session/BikeComputer.svelte';
	import { roadContext } from '$lib/session/computer-pages';
	import RidingSurface from '$lib/session/RidingSurface.svelte';
	import ViewSwitch from '$lib/world/ViewSwitch.svelte';
	import type { RoadMate } from '$lib/channel/road-mates';
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
		cassette = true,
		ghost,
		pacer,
		onend,
		onrepair,
		ending = false,
		onflag,
		ontv,
		controls,
		setup,
		foot,
		worldClass = '',
		mates,
		climbed,
		ride,
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
		cassette?: boolean;
		/** Your ghost (ADR-0068): its split, where it rides (#3245) and its calls (#3246). */
		ghost?: GhostSplit;
		/** The pacer, on a solo route ride only (#3281): its pick in the now bar, and where it rides. */
		pacer?: Pacer;
		/** End ride; absent while there is nothing to end. */
		onend?: () => void;
		ending?: boolean;
		/** Ride on with another trainer; absent where the page reattaches by itself. */
		onrepair?: (next: Trainer) => void;
		/** The ⚑ and TV (#52, #1632, #3894), the road ride's and a voice channel's alike. */
		onflag?: () => void;
		ontv?: () => void;
		/** The caller's own controls, after the ride's in the now bar. */
		controls?: Snippet;
		/** What has the focus before the first stroke. */
		setup?: Snippet;
		/** Under the numbers — the channel's consent line. */
		foot?: Snippet;
		/** Undoes the page's gutters so the ride fills the frame (TARGETS ride-road-world 2). */
		worldClass?: string;
		/** A voice channel's mates on this road (#3117): the world draws them at their own metres. */
		mates?: () => readonly RoadMate[];
		/** Metres climbed, from a ride that outlives this screen (ADR-0093); absent, it counts its own. */
		climbed?: number;
		/** That ride, so its world reopened mid-ride keeps the picture's moments; absent, each world is its own. */
		ride?: object;
		class?: string;
	} = $props();

	const road = $derived(free.road);
	// The climb card on a road (#3645): CLIMB opens by itself, and says so.
	const view = $derived(
		road
			? {
					road: road.profile,
					m: road.m,
					mps: road.virtualMps,
					reverse: road.reverse,
				}
			: null,
	);
	const climb = $derived(raced(climbView(view), ghost?.since));
	const map = $derived(mapView(view));
	watchClimbCues(
		() => climb,
		() => ghost?.call,
	);
	const inWatts = $derived(free.mode === 'watts');
	// The world under the docks where this device has it on and the ride has
	// a road (ADR-0066); a world that cannot draw hands the ride to the Skyline.
	const ICON = 'btn btn-secondary icon-btn-lg p-0';
	const world = createWorldView();
	const inWorld = $derived(world.on && !!road);

	const atMin = $derived(
		inWatts ? free.watts === WATTS.min : free.grade === GRADE.min,
	);
	const atMax = $derived(
		inWatts ? free.watts === WATTS.max : free.grade === GRADE.max,
	);
	// Warm up and Cool down (#4100): off a road, a length picked once.
	const RAMPS: { kind: RampKind; label: string }[] = [
		{ kind: 'warmup', label: 'Warm up' },
		{ kind: 'cooldown', label: 'Cool down' },
	];
	// One button, one menu: each ramp at each length.
	const rampItems = () =>
		RAMPS.flatMap((r) =>
			RAMP.minutes.map((minutes) => ({
				label: `${r.label} · ${minutes} min`,
				onSelect: () => free.startRamp(r.kind, minutes),
			})),
		);
	const rampLabel = $derived(
		RAMPS.find((r) => r.kind === (free.ramp?.kind ?? free.rampDone))?.label,
	);
	// Your ghost and the pacer, where each rides now (#3245, #3281).
	const haunts = $derived(
		[ghost?.rider, pacer?.rider].filter((g) => g != null),
	);
	// The pacer at each Category's par, one menu (#3281).
	const pacerItems = () => [
		...PACER_CATEGORIES.map((category) => ({
			label: `Pacer ${category} · ${PACER_PAR[category]} W/kg`,
			onSelect: () => pacer?.pick(category),
		})),
		...(pacer?.category
			? [{ label: 'No pacer', onSelect: () => pacer?.pick(null) }]
			: []),
	];
	const pair = createPairAgain((next) => onrepair?.(next));
	const fault = $derived(stale && !idle ? trainerLine('silent') : null);
	// Once per device, to a rider who kept "Don't make me shift" (#3333).
	const hint = untrack(() => gearsNews(!cassette));

	// The ⚑'s own acknowledgement (#52): consent in plain words, at the
	// moment of the tap, never blocking.
	let flagNotice = $state(false);
	function flag() {
		onflag?.();
		flagNotice = true;
		setTimeout(() => (flagNotice = false), FLAG_NOTICE_MS);
	}

	// Metres climbed this ride (TARGETS ride-free-road 3).
	const ownClimb = countClimbed({
		get recording() {
			return free.recording;
		},
		get road() {
			return free.road;
		},
	});

	// Climb repeats past Everest (#3193): a fanfare and a line, once a ride.
	// A screen opened again past it says so without the fanfare.
	const metres = $derived(road ? (climbed ?? ownClimb.m) : 0);
	const summited = $derived(free.repeats && metres >= EVEREST_M);
	let wasSummited = untrack(() => summited);
	$effect(() => {
		if (summited && !wasSummited) play('fanfare');
		wasSummited = summited;
	});

	const WORDS = 'text-2xl leading-6';
	// M and V from a key or a bridged controller (#4236).
	$effect(() => bindViewKeys((k) => !!board.onKey(k)));
</script>

{#snippet faultLine()}
	{#if fault}
		<!-- Ride-critical status is slot 1's first line (G3), never a toast. -->
		<div
			data-status-line
			role="alert"
			class="flex min-w-0 flex-1 items-center gap-4"
		>
			<span class="bg-danger size-2.5 shrink-0 rounded-full"></span>
			<p class="min-w-0 truncate {WORDS}">{pair.error ?? fault.text}</p>
			{#if onrepair}
				<button
					onclick={() => void pair.run()}
					disabled={pair.busy}
					class="btn btn-primary btn-ride shrink-0"
					>{pair.busy ? 'Pairing…' : fault.action}</button
				>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet notes()}
	{#if free.ramp}
		<p data-testid="ramp-line" class="num truncate" aria-live="polite">
			{rampLabel} · {formatClock(free.ramp.left)} left
		</p>
	{:else if free.rampDone}
		<p data-testid="ramp-line" class="truncate" aria-live="polite">
			{rampLabel} done
		</p>
	{/if}
	{#if summited}
		<p data-testid="everest-line" class="text-neon truncate font-bold">
			The height of Everest, climbed
		</p>
	{/if}
	{#if flagNotice}
		<p class="text-muted truncate">{FLAG_SAID.after}</p>
	{:else if hint}
		<p class="text-muted truncate">{hint}</p>
	{/if}
{/snippet}

{#snippet actions()}
	<ModeSwitch mode={free.mode} road={!!road} onmode={free.setMode} />
	{#if !road}
		<!-- The number they move is the chip's (SPEC "Grade mode"). -->
		<button
			onclick={() => free.nudge(-1)}
			disabled={atMin}
			class="btn btn-secondary btn-ride"
			aria-label={inWatts ? 'fewer watts' : 'lower grade'}
			><Minus size={18} /></button
		>
		<button
			onclick={() => free.nudge(1)}
			disabled={atMax}
			class="btn btn-secondary btn-ride"
			aria-label={inWatts ? 'more watts' : 'steeper grade'}
			><Plus size={18} /></button
		>
	{/if}
	<!-- The gears arrive with a trainer: nothing to shift before one pairs. -->
	{#if gear && shift && !inWatts && !idle}
		<GearShift
			{shift}
			{gear}
			off={gearsEnabled('screen') ? shiftOff : EASIER_HARDER_OFF.gated}
			{cassette}
		/>
	{/if}
	{#if pacer && road && !inWatts}
		<!-- The pacer rides where your own watts move your dot (#3281): in
		     Watts the trainer moves it, so the pick is not offered there. -->
		<button
			onclick={(event) => {
				const box = event.currentTarget.getBoundingClientRect();
				openMenu(pacerItems(), box.left, box.top, event.currentTarget);
			}}
			aria-haspopup="menu"
			class="btn btn-secondary btn-ride whitespace-nowrap max-md:hidden"
			>{pacer.category ? `Pacer ${pacer.category}` : 'Ride with a pacer'}
			<ChevronDown size={16} /></button
		>
	{/if}
	{#if road && !inWatts && (free.repeatable || free.repeats)}
		<!-- Climb repeats (#3193): SIM only, so not offered in Watts. -->
		<button
			onclick={() => free.setRepeats(!free.repeats)}
			class="btn btn-secondary btn-ride whitespace-nowrap max-md:hidden"
			>{free.repeats ? 'Stop repeats' : 'Climb repeats'}</button
		>
	{/if}
	<!-- A phone's bar keeps the mode, the shifter and End in view. -->
	{#if onflag}<span class="contents max-md:hidden"
			><FlagButton onflag={flag} sends="after" /></span
		>{/if}
	{#if road}<span class="contents max-md:hidden"
			><ViewSwitch {world} drawn={inWorld} /></span
		>{/if}
	{#if ontv}
		<button
			onclick={ontv}
			class="{ICON} max-md:hidden"
			aria-label="TV mode"
			title="TV mode"><MonitorUp size={20} /></button
		>
	{/if}
	{#if onend}
		<!-- End ride saves where you are; carrying on is the road-end
		     card's offer, not this button's (TARGETS ride-free-road 10). -->
		<button
			onclick={onend}
			disabled={ending}
			class="btn btn-secondary btn-ride whitespace-nowrap">End ride</button
		>
	{/if}
{/snippet}

{#snippet ramps()}
	{#if !road}
		<!-- Warm up and Cool down (#4100), one button off a road. -->
		<div class="contents">
			{#if free.ramp}
				<button onclick={free.stopRamp} class="btn btn-secondary btn-ride"
					>Stop {rampLabel?.toLowerCase()}</button
				>
			{:else}
				<button
					onclick={(event) => {
						const box = event.currentTarget.getBoundingClientRect();
						openMenu(rampItems(), box.left, box.top, event.currentTarget);
					}}
					aria-haspopup="menu"
					class="btn btn-secondary btn-ride whitespace-nowrap max-md:hidden"
					>Warm up or cool down <ChevronDown size={16} /></button
				>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet glance()}
	<RideRail
		watts={free.live?.seconds ? free.live.power3 : watts}
		stale={stale || idle}
		target={inWatts ? free.targetWatts : 0}
		{ftp}
		{kg}
		stats={free.live}
		road={road?.readout}
		grade={road || inWatts ? undefined : free.grade}
		speedKph={road ? road.virtualMps * 3.6 : undefined}
		{cadence}
		{hr}
		elapsed={free.seconds}
		title={freeRideLabel(road)}
		gear={gear && !inWatts ? gear.label : undefined}
		status={faultLine}>{@render notes()}</RideRail
	>
{/snippet}

{#snippet bar()}
	{@render actions()}
	{@render ramps()}
	{@render controls?.()}
{/snippet}

{#snippet computer()}
	<!-- The dot's speed is RIDE's (one home); km and grade are slot 1's. -->
	<BikeComputer
		docked
		wide
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
		split={ghost?.split ?? undefined}
		pacer={pacer?.gap}
		{climb}
		{map}
		climbOpens
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
		ghosts={haunts}
		{watts}
		{ftp}
	/>
{/snippet}

{#snippet worldSlot()}
	{#await world.load() then { default: RideWorld }}
		{#if road}
			{@const on = road}
			<RideWorld
				road={on.profile}
				loop={on.loop}
				metre={() => ({
					m: road?.m ?? on.m,
					mps: road?.virtualMps ?? 0,
					reverse: road?.reverse ?? on.reverse,
				})}
				{mates}
				{watts}
				silent={stale}
				{ftp}
				progress={null}
				ghosts={() => haunts}
				onfail={world.fail}
				onflat={world.flatten}
				{ride}
			/>
		{/if}
	{/await}
{/snippet}

{#snippet roadEnd()}
	<RoadEnd {free} onsave={() => onend?.()} />
{/snippet}

<RideNarrator {view} {watts} {ftp} {stale} />

<RidingSurface
	class="flex-1 {worldClass} {extra}"
	world={inWorld ? worldSlot : undefined}
	moment={roadEndOffered(free, false) ? roadEnd : undefined}
	{bar}
	rail={glance}
>
	{#snippet focus()}
		{#if setup && !free.recording}{@render setup()}{/if}
	{/snippet}

	{#snippet numbers()}
		{@render computer()}
		{@render foot?.()}
	{/snippet}

	{#snippet horizon()}
		{#if road}
			<!-- Over the world a strip along the bottom; flat, the ground. -->
			<div class="relative h-full flex-1">
				<div class="absolute inset-0">{@render skyline(road)}</div>
			</div>
		{/if}
	{/snippet}
</RidingSurface>
