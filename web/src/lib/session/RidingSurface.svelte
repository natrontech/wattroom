<script lang="ts">
	/**
	 * The riding surface (ADR-0046, #3081): one layout for a session's
	 * Training place, a solo ride and a free ride. Riding is the whole
	 * screen: the world, or flat the horizon (the workout's graph or the
	 * Skyline), fills the surface edge to edge at every width, and the slots
	 * are flat `ride-panel`s over it, each its content's size. Your numbers
	 * hang top left with slot 1 under them, the moment card, what has the
	 * focus and the crew hang under the jukebox seat at the right (a phone:
	 * along the bottom), and over the world the Skyline runs along the
	 * bottom. A shared screen takes the stage. The ride's controls are not
	 * drawn here: `bar` hands them to the now bar.
	 */
	import { untrack, type Snippet } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { intoBar, rideBar } from '#lib/nav/ride-bar.svelte.ts';
	import { device } from '#lib/device.svelte.ts';
	import { createMoments } from '#lib/moments/index.ts';
	import SummitStrip from '#lib/ride/SummitStrip.svelte';
	import { prefersReducedMotion } from '#lib/motion/index.ts';
	import { COLUMN_SEAT, offerSeat } from '#lib/channel/stage-slot.svelte.ts';
	import { shifterSlot } from '#lib/ble/controller-slot.svelte.ts';
	import { railPress } from '#lib/session/computer-pages.ts';
	import { computerShown } from '#lib/session/computer-shown.svelte.ts';
	import {
		CORRIDOR,
		GAP_PX,
		INSET_PX,
		BAND_MAX_PX,
		JUKEBOX_SEAT,
		SIDE_MAX,
		SKYLINE_PX,
		STAGE,
		STRIP_PX,
		momentAt,
		place,
	} from './docks';

	let {
		header,
		rail,
		roadMap,
		focus,
		numbers,
		crew,
		horizon,
		world,
		room,
		moment,
		centre,
		dockIn = false,
		seat,
		stage = false,
		clean = false,
		onshow,
		cleanLine,
		bar,
		class: extra = '',
	}: {
		header?: Snippet;
		/**
		 * The ride's glance across the top (the ride HUD, 2026-11): with it,
		 * `numbers` shows only for MAP, `header` not at all, and over the
		 * world there is no Skyline strip.
		 */
		rail?: Snippet;
		/**
		 * The road from above, the view switch's Map (M): under the rail it
		 * takes the ground between the rail and the Skyline, no panel.
		 */
		roadMap?: Snippet;
		focus: Snippet;
		numbers?: Snippet;
		crew?: Snippet;
		horizon?: Snippet;
		/** The world, drawn behind the docks. */
		world?: Snippet;
		/** The view switch's Room: the cozy room for ground, under the rail. */
		room?: Snippet;
		/** A moment card — a sprint armed or live (D12) — over the world. */
		moment?: Snippet;
		/** The one thing the corridor holds: the count-in's digit (TARGETS ride-countin 2). */
		centre?: Snippet;
		/** The count-in is on: the slots fly to their docks through the moments queue (#3087). */
		dockIn?: boolean;
		/**
		 * A session's jukebox seat, offered to the player while the people
		 * column is folded away (#3668), with the now-playing line under it.
		 */
		seat?: Snippet;
		/** A shared screen has the focus: it takes the stage, the horizon a strip. */
		stage?: boolean;
		/** Clean view (#3216): over the world, only your numbers, the road and the Skyline. */
		clean?: boolean;
		/** Clean view's way back: one chip, so a hidden control keeps a hint (ADR-0062). */
		onshow?: () => void;
		/** Slot 1's road line, which Clean view keeps beside the chip. */
		cleanLine?: string;
		/** The ride's controls, drawn in the now bar while this surface is up. */
		bar?: Snippet;
		class?: string;
	} = $props();

	// The dock-in is a queued moment: cue the count-in's first frame, hit when
	// its `enter` ends. Reduced motion never stages it: the slots stand held.
	let docking = $state(false);
	$effect(() => {
		if (!dockIn || !world || prefersReducedMotion.current) return;
		const queue = createMoments({ now: () => performance.now() });
		queue.stage({ kind: 'dockin', payload: null });
		const step = () => {
			for (const e of queue.tick())
				if (e.kind === 'dockin') docking = e.stage === 'enter';
		};
		step();
		const id = setInterval(step, 50);
		return () => {
			clearInterval(id);
			docking = false;
		};
	});
	const dock = (i: number, x: string, y: string) =>
		docking ? `--dock-i:${i};--dock-x:${x};--dock-y:${y};` : '';
	const dockClass = $derived(docking ? 'dock-in' : '');

	// What slot 1 leaves free decides where the moment card goes (D12): a
	// measured fit, not a breakpoint (Jan, 2026-10-06).
	let width = $state(0);
	let slotWidth = $state(0);
	let playingH = $state(0);
	const momentPlace = $derived(momentAt(width, INSET_PX + slotWidth));
	const seatLeft = `${JUKEBOX_SEAT.x0 * 100}%`;
	const seatW = `${(JUKEBOX_SEAT.x1 - JUKEBOX_SEAT.x0) * 100}%`;
	const seatH = `${(JUKEBOX_SEAT.y1 - JUKEBOX_SEAT.y0) * 100}%`;
	// The right column hangs under the seat, empty or not: on a solo ride
	// nothing grows into it (TARGETS ride-road-world 14).
	const underSeat = `calc(${INSET_PX}px + ${seatH} + ${GAP_PX}px)`;
	const side = `max-width:calc(${SIDE_MAX * 100}% - ${INSET_PX}px)`;
	// A dock with nothing drawn in it (anchors and whitespace only) is not drawn either.
	const panel = 'ride-panel [&:not(:has(*))]:hidden';
	// A column of docks: it lets the world through, its panels do not.
	const column =
		'pointer-events-none absolute flex flex-col gap-3 [&>*]:pointer-events-auto [&>*]:max-w-full [&>*]:shrink-0';
	const phone = $derived(device.narrow);
	// Over the world the Skyline is a strip along the bottom; flat, the
	// horizon is the ground itself.
	// Over the world the Skyline runs along the bottom: a panel, or under the
	// rail edge to edge on a fade, tall enough to read the slope and your
	// watts along it (the ride HUD, 2026-11).
	// MAP, asked for by M or the view switch, is a view of the ground.
	const mapShown = $derived(!clean && computerShown.page === 'map');
	// Flat, the horizon is the ground; under Map it is the band again, so the
	// slope and your watts stay in view.
	const skyline = $derived(!!horizon && (!!world || (!!rail && mapShown)));
	let bandH = $state(0);
	const floor = $derived(
		INSET_PX +
			(!skyline ? 0 : rail ? bandH : (stage ? STRIP_PX : SKYLINE_PX) + GAP_PX),
	);
	// A phone has no room for the stage: a shared screen joins its column.
	const onStage = $derived(stage && !phone);
	// The rail runs the width, up to the seat when the player has one.
	const railRight = $derived(
		seat && !clean ? `calc(100% - ${seatLeft} + ${GAP_PX}px)` : `${INSET_PX}px`,
	);
	const left = $derived(
		phone
			? `left:${INSET_PX}px;right:${INSET_PX}px;top:${INSET_PX}px;max-height:62%`
			: rail
				? `left:${INSET_PX}px;top:${INSET_PX}px;bottom:${floor}px;right:${railRight}`
				: `left:${INSET_PX}px;top:${INSET_PX}px;bottom:${floor}px;max-width:min(${BAND_MAX_PX}px, calc(${seatLeft} - ${INSET_PX + GAP_PX}px))`,
	);
	// The rail's details: its chevron opens its second row. The computer
	// stays mounted behind it for MAP, which shows while it is asked for (M,
	// the view switch).
	const details = $derived(!clean && computerShown.details);
	function toggleDetails() {
		railPress('details', { open: details, map: mapShown });
	}
	// A controller's Select is the same tap, and its Back shuts the row and
	// brings the computer home to RIDE (#4532): BikeControl's Click V2 sends
	// them from A and B.
	$effect(() =>
		shifterSlot.onAction((action, edge) => {
			if (edge !== 'down') return;
			if (action === 'back')
				railPress('back', { open: details, map: mapShown });
			else if (action === 'details' && rail && !clean) toggleDetails();
		}),
	);
	$effect(() => {
		if (!rail) return;
		return () => (computerShown.details = false);
	});
	// Flat, the ground starts under the rail, so it hides none of the graph.
	let railH = $state(0);
	const groundTop = $derived(
		rail && !world && railH ? `top:${INSET_PX + railH + GAP_PX}px` : '',
	);
	const right = $derived(
		phone
			? `left:${INSET_PX}px;right:${INSET_PX}px;bottom:${floor}px;max-height:33%`
			: `right:${INSET_PX}px;top:calc(${underSeat} + ${playingH ? playingH + GAP_PX : 0}px);${side};bottom:${floor}px`,
	);

	// The now bar makes room for the ride's controls while this surface is up.
	$effect(() => {
		if (!bar) return;
		untrack(() => (rideBar.on = true));
		return () => (rideBar.on = false);
	});
</script>

{#if bar && rideBar.target}
	<!-- Rendered here, so the controls keep this tree's context; shown there. -->
	<div class="contents" {@attach intoBar(rideBar.target)}>{@render bar()}</div>
{/if}

<div
	class="relative min-h-0 overflow-hidden {extra}"
	data-surface={world ? 'docked' : 'flat'}
	bind:clientWidth={width}
>
	<!-- The ground, edge to edge: the world, or flat the horizon's graph or
	     Skyline. -->
	<div
		class="absolute inset-0 flex flex-col {world
			? 'bg-(--world-sky-zenith)'
			: 'flat-ground'}"
		style={groundTop}
		data-dock={world ? 'world' : 'horizon'}
	>
		{#if room}{@render room()}{:else if world}{@render world()}{:else if horizon}{@render horizon()}{/if}
	</div>
	{#if rail && world}
		<!-- The rail stands on the world under a fade, edge to edge: no panel,
		     at the panels' 85 % where its words are (SPEC). The crew stands
		     under a fade from its own edge: the right, a phone's foot. -->
		<div
			aria-hidden="true"
			class="from-surface/90 via-surface/85 pointer-events-none absolute inset-x-0 top-0 bg-linear-to-b to-transparent"
			style="height:{INSET_PX + railH + 48}px"
		></div>
		{#if crew && !clean}
			<div
				aria-hidden="true"
				class="from-surface/90 via-surface/70 pointer-events-none absolute to-transparent {phone
					? 'inset-x-0 bottom-0 h-[40%] bg-linear-to-t'
					: 'inset-y-0 right-0 w-[34%] bg-linear-to-l'}"
			></div>
		{/if}
	{/if}
	{#if rail && mapShown && roadMap}
		<!-- Map is a view: the road from above over the ground, between the
		     rail and the Skyline (the ride HUD, 2026-11), on land (#4536).
		     The rail's own surface fades into it, as it does over the world. -->
		<div
			data-dock="map"
			class="map-land absolute inset-0 px-[6%] forced-colors:bg-[Canvas]"
			style="padding-top:{INSET_PX + railH}px;padding-bottom:{floor}px"
		>
			<div
				aria-hidden="true"
				class="from-surface via-surface/85 pointer-events-none absolute inset-x-0 top-0 bg-linear-to-b to-transparent"
				style="height:{INSET_PX + railH + 48}px"
			></div>
			{@render roadMap()}
		</div>
	{/if}
	{#if centre}
		<!-- In the corridor's upper half, above where the chase camera
		     draws you (RIDER_BOX), as v3-motion's GO stands. -->
		<div
			class="cave absolute grid items-start justify-items-center pt-[9%]"
			style={place(CORRIDOR)}
		>
			{@render centre()}
		</div>
	{/if}
	<!-- Top left: your numbers, the watts first, then slot 1. -->
	<div
		class="{column} {phone ? 'items-stretch' : 'items-start'} {rail
			? ''
			: 'overflow-y-auto'}"
		style={left}
		bind:offsetWidth={slotWidth}
	>
		{#if rail}
			<!-- The numbers are only numbers (#4538): the chevron at the rail's
			     edge opens its second row, and stays put either way. -->
			<div
				data-dock="rail"
				class="flex w-full items-start gap-3 {dockClass}"
				style={dock(0, '0', '-40px')}
				bind:offsetHeight={railH}
			>
				<div class="min-w-0 flex-1">{@render rail()}</div>
				<button
					type="button"
					data-testid="rail-toggle"
					onclick={toggleDetails}
					aria-expanded={details}
					aria-controls="rail-details"
					aria-label={details ? 'Hide ride details' : 'Show ride details'}
					title={details ? 'Hide ride details' : 'Show ride details'}
					class="icon-btn border-neon/60 text-neon hover:bg-neon/10 size-[max(2.75rem,7vh)] border {details
						? 'bg-neon/10'
						: 'bg-surface/85'}"
				>
					<ChevronDown
						aria-hidden="true"
						class="size-[60%] motion-safe:transition-transform {details
							? 'rotate-180'
							: ''}"
					/>
				</button>
			</div>
		{/if}
		{#if numbers}
			<div
				data-dock="numbers"
				class="{panel} {dockClass} {rail ? '!hidden' : ''}"
				style={dock(0, '-40px', '0')}
			>
				{@render numbers()}
			</div>
		{/if}
		{#if clean}
			<div class="ride-panel ride-word flex items-center gap-4 px-4">
				<button
					data-testid="clean-exit"
					class="text-ink min-h-11 font-semibold"
					onclick={onshow}>Show panels · H</button
				>
				{#if cleanLine}<span class="num text-muted">{cleanLine}</span>{/if}
			</div>
		{:else if header}
			<div
				data-dock="header"
				class="{panel} {dockClass} {rail ? '!hidden' : ''}"
				style={dock(1, '0', '-40px')}
			>
				{@render header()}
			</div>
		{/if}
	</div>
	{#if !clean && moment && momentPlace === 'top'}
		<!-- Top-centre, in what the left column leaves before the seat. -->
		<div
			class="absolute flex justify-center"
			style="left:{INSET_PX +
				slotWidth +
				GAP_PX}px;right:calc(100% - {seatLeft} + {GAP_PX}px);top:{INSET_PX}px"
		>
			<div data-dock="moment" class="ride-panel">{@render moment()}</div>
		</div>
	{/if}
	{#if seat && !clean}
		<!-- The hole the player flies to: nothing is drawn over it (RMF). -->
		<div
			data-seat="jukebox"
			class="absolute"
			style="right:{INSET_PX}px;top:{INSET_PX}px;width:{seatW};height:{seatH}"
			{@attach (node) => offerSeat(node, COLUMN_SEAT)}
		></div>
		<!-- The now-playing line, directly under the seat at its width. -->
		<div
			data-testid="now-playing"
			class="absolute [&:not(:has(*))]:hidden"
			style="right:{INSET_PX}px;top:{underSeat};width:{seatW}"
			bind:offsetHeight={playingH}
		>
			{@render seat()}
		</div>
	{/if}
	{#if !clean}
		<!-- The crew's side, under the seat (a phone: along the bottom): the
		     moment card when it does not fit top-centre, what has the focus,
		     then the crew. -->
		<div
			class="{column} overflow-y-auto {phone ? '' : 'items-end'}"
			style={right}
		>
			{#if moment && momentPlace === 'seat'}
				<!-- Never wider than the column, so never into the corridor (G3). -->
				<div data-dock="moment" class="ride-panel">{@render moment()}</div>
			{/if}
			{#if !onStage}
				<div
					data-dock="focus"
					class="{panel} {dockClass}"
					style={dock(2, '40px', '0')}
				>
					{@render focus()}
				</div>
			{/if}
			{#if crew}
				<div
					data-dock="crew"
					class="{rail ? '[&:not(:has(*))]:hidden' : panel} {dockClass}"
					style={dock(3, '40px', '0')}
				>
					{@render crew()}
				</div>
			{/if}
		</div>
		{#if onStage}
			<div data-dock="focus" class="{panel} absolute grid" style={place(STAGE)}>
				{@render focus()}
			</div>
		{/if}
	{/if}
	<div
		class="absolute right-0 left-0 z-10 flex justify-center"
		style="bottom:{floor}px"
	>
		<SummitStrip />
	</div>
	{#if skyline && horizon && rail}
		<div
			aria-hidden="true"
			class="from-surface/80 via-surface/35 pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t to-transparent"
			style="height:{bandH + 48}px"
		></div>
		<div
			data-dock="horizon"
			class="absolute inset-x-0 bottom-0 overflow-hidden {dockClass}"
			style="{dock(4, '0', '40px')}height:{stage
				? `${STRIP_PX}px`
				: 'max(120px, 18vh)'}"
			bind:offsetHeight={bandH}
		>
			{@render horizon()}
		</div>
	{:else if skyline && horizon}
		<div
			data-dock="horizon"
			class="{panel} {dockClass} absolute overflow-hidden"
			style="{dock(
				4,
				'0',
				'40px',
			)}left:{INSET_PX}px;right:{INSET_PX}px;bottom:{INSET_PX}px;height:{stage
				? STRIP_PX
				: SKYLINE_PX}px"
		>
			{@render horizon()}
		</div>
	{/if}
</div>
