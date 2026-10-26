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
	import { askPage } from '$lib/session/computer-pages';
	import { computerShown } from '$lib/session/computer-shown.svelte';
	import { REASONS, viewSwitch, type SkylineReason } from './ride-view';

	let {
		world,
		drawn,
	}: {
		world: {
			readonly reason: SkylineReason | null;
			flatten(): void;
			retry(): void;
		};
		/** The world draws on this screen now. */
		drawn: boolean;
	} = $props();

	const onMap = $derived(computerShown.page === 'map');
	const state = $derived(
		viewSwitch({ world: drawn, reason: world.reason, onMap }),
	);
	const why = $derived(world.reason ? REASONS[world.reason] : null);

	// 3D and Flat are the horizon's, and a rider on MAP who picks one is
	// leaving the map for it: the computer goes back to RIDE.
	function to(segment: '3d' | 'flat') {
		if (onMap) askPage('ride');
		if (segment === '3d' && !drawn) world.retry();
		if (segment === 'flat' && drawn) world.flatten();
	}
	const seg = (on: boolean) =>
		`btn btn-ride whitespace-nowrap ${on ? 'btn-secondary' : 'btn-ghost'}`;
</script>

<div
	class="border-muted/20 flex rounded-lg border"
	role="group"
	aria-label="view"
	data-testid="view-switch"
>
	<button
		onclick={() => to('3d')}
		aria-pressed={state.pressed === '3d'}
		disabled={!state.worldOffered}
		title={why?.line}
		class="{seg(state.pressed === '3d')} disabled:opacity-60"
		>3D{#if why?.short}<span class="text-muted ml-1 text-xs font-normal"
				>{state.worldOffered ? '⟳ ' : ''}{why.short}</span
			>{/if}</button
	>
	<button
		onclick={() => to('flat')}
		aria-pressed={state.pressed === 'flat'}
		class={seg(state.pressed === 'flat')}>Flat</button
	>
	{#if computerShown.maps}
		<button
			onclick={() => askPage('map')}
			aria-pressed={state.pressed === 'map'}
			class={seg(state.pressed === 'map')}>Map</button
		>
	{/if}
	<!-- The whole sentence for a screen reader, and for the e2e specs that
	     read why a world went flat (`world.ts`): present only while it is. -->
	{#if why}
		<p role="status" class="sr-only" data-testid="flat-road">{why.line}</p>
	{/if}
</div>
