<script lang="ts">
	/**
	 * Where the rider looks, in one place on every riding surface (#4217,
	 * ADR-0091): 3D, Flat or the computer's MAP. It replaces the world's Flat
	 * icon, the flat road's "Ride in 3D" and paging over to MAP. A world that
	 * fell back says why on its 3D segment, and a tap there tries again; where
	 * a tap cannot (no WebGL, a window too short), 3D is disabled with the why
	 * as its hint (ux.md).
	 *
	 * Chrome, so neon and flat (ADR-0005), in the ride's one segmented
	 * control's shape (FreeRiding's "what you set").
	 */
	import { untrack } from 'svelte';
	import { channelConnection } from '#lib/channel/connection.svelte.ts';
	import { hasChannel } from '#lib/channel/context.ts';
	import { rideRoom } from '#lib/channel/ride-room.svelte.ts';
	import { askPage } from '#lib/session/computer-pages.ts';
	import { tooltip } from '#lib/tooltip.svelte.ts';
	import { computerShown } from '#lib/session/computer-shown.svelte.ts';
	import { rideOffers } from '#lib/ride/ride-offers.svelte.ts';
	import {
		flipped,
		press,
		REASONS,
		VIEW_ASK,
		viewSwitch,
		type SkylineReason,
		type ViewSegment,
	} from './ride-view';

	let {
		world,
		drawn,
		road = true,
	}: {
		world: {
			readonly reason: SkylineReason | null;
			flatten(): void;
			retry(): void;
		};
		/** The world draws on this screen now. */
		drawn: boolean;
		/** The ride has a road: off one there is no 3D to look at. */
		road?: boolean;
	} = $props();

	// The cozy room needs a call to be in; a solo ride has neither (ux.md).
	const inChannel = hasChannel();
	const roomy = $derived(
		inChannel && !!channelConnection.call?.address.channel,
	);
	$effect(() => {
		rideRoom.offered = roomy;
		return () => {
			rideRoom.offered = false;
			rideRoom.on = false;
		};
	});

	const onMap = $derived(computerShown.page === 'map');
	const state = $derived(
		viewSwitch({
			world: drawn,
			reason: world.reason,
			onMap,
			inRoom: rideRoom.on && roomy,
		}),
	);
	const why = $derived(world.reason ? REASONS[world.reason] : null);

	// One view at a time (#4535): a rider on MAP who picks any other segment
	// is leaving the map for it, so the computer goes back to RIDE; MAP
	// would otherwise stay drawn over the room.
	function to(segment: ViewSegment) {
		const next = press(segment, onMap);
		rideRoom.on = next.room;
		if (next.page) askPage(next.page);
		if (segment === '3d' && !drawn) world.retry();
		if (segment === 'flat' && drawn) world.flatten();
	}
	// MAP asked for another way, the M key or the phone, leaves the room.
	$effect(() => {
		if (onMap) untrack(() => (rideRoom.on = false));
	});
	// The V key's 3D / Flat (#4236).
	$effect(() => {
		const flip = (event: Event) => {
			const next = flipped(state);
			if (!next) return;
			to(next);
			event.preventDefault();
		};
		window.addEventListener(VIEW_ASK, flip);
		return () => window.removeEventListener(VIEW_ASK, flip);
	});
	// The phone's view row is this switch (ride-controls.ts): each segment
	// drawn here, and live, is offered to it, and runs as a tap here does.
	$effect(() => {
		if (!road && !roomy) return;
		const offs = [
			...(road && state.worldOffered
				? [rideOffers.offer('view-3d', () => to('3d'))]
				: []),
			rideOffers.offer('view-flat', () => to('flat')),
			...(computerShown.maps
				? [rideOffers.offer('view-map', () => to('map'))]
				: []),
			...(roomy ? [rideOffers.offer('view-room', () => to('room'))] : []),
		];
		return () => offs.forEach((off) => off());
	});
	$effect(() => {
		computerShown.world = drawn;
		return () => {
			computerShown.world = false;
		};
	});
	// The row's icon buttons' height (h-11: 33 px on a desk, 44 on a phone,
	// G5) and a tight gutter: three words beside them must not widen slot 1
	// past its own rows (design check, #4217).
	const seg = (on: boolean) =>
		`btn ride-word h-11 px-2 py-0 font-semibold whitespace-nowrap ${on ? 'btn-secondary' : 'btn-ghost'}`;
</script>

{#if road || roomy}
	<div
		class="flex items-center"
		role="group"
		aria-label="view"
		data-testid="view-switch"
	>
		{#if road}
			<button
				onclick={() => to('3d')}
				aria-pressed={state.pressed === '3d'}
				disabled={!state.worldOffered}
				{@attach tooltip(why?.line)}
				class={seg(state.pressed === '3d')}
				>3D{#if why?.short}<span class="text-muted ml-1 font-normal"
						>{state.worldOffered ? '⟳ ' : ''}{why.short}</span
					>{/if}</button
			>
		{/if}
		<button
			onclick={() => to('flat')}
			aria-pressed={state.pressed === 'flat'}
			class={seg(state.pressed === 'flat')}>Flat</button
		>
		{#if computerShown.maps}
			<button
				onclick={() => to('map')}
				aria-pressed={state.pressed === 'map'}
				class={seg(state.pressed === 'map')}>Map</button
			>
		{/if}
		{#if roomy}
			<button
				onclick={() => to('room')}
				aria-pressed={state.pressed === 'room'}
				class={seg(state.pressed === 'room')}>Lounge</button
			>
		{/if}
		<!-- The whole sentence for a screen reader, and for the e2e specs that
	     read why a world went flat (`world.ts`): present only while it is. -->
		{#if why}
			<p role="status" class="sr-only" data-testid="flat-road">{why.line}</p>
		{/if}
	</div>
{/if}
