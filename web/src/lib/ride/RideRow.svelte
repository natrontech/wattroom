<script lang="ts">
	/**
	 * One ride in the history list (#3053, out of history/+page.svelte): the
	 * whole row opens it, a right-click holds the rest, and a ride only this
	 * device knows offers nothing it cannot do.
	 */
	import { contextMenu, MENU_HINT } from '$lib/context-menu.svelte';
	import { formatClock } from '$lib/format';
	import type { RideRecord } from '$lib/history.svelte';
	import { kmAndClimb } from '$lib/road/profile';
	import { ridePlace, type ServerRide } from '$lib/ride/list';
	import { rideRowMenu } from '$lib/ride/row-menu';
	import ShareToggle from '$lib/ride/ShareToggle.svelte';

	let {
		ride,
		server,
		highlighted,
		forget,
	}: {
		ride: RideRecord;
		/** The server's copy; absent for a ride only this device holds. */
		server?: ServerRide;
		/** Ringed: the ride a link or the calendar pointed at. */
		highlighted: boolean;
		forget: (ride: ServerRide) => void;
	} = $props();
</script>

<!-- A device-only ride has no server to flip or delete, so its row offers
     nothing and keeps the browser's own menu. -->
<li
	id="ride-{ride.id}"
	title={server ? MENU_HINT : undefined}
	class="panel relative flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4 {highlighted
		? 'ring-z2/70 ring-1'
		: ''}"
	{@attach contextMenu(() => (server ? rideRowMenu(server, forget) : []))}
>
	{#if server}
		<!-- The whole row opens the ride (#503): a tap target the size of the
		     row, which is what a rider off the bike reaches for. Overlaid
		     rather than wrapping, so the share button stays its own control. -->
		<a
			href="/history/{ride.id}"
			class="focus-visible:ring-neon/60 absolute inset-0 rounded-lg focus-visible:ring-2 focus-visible:outline-none"
		>
			<span class="sr-only">Open {ride.workoutName}</span>
		</a>
	{/if}
	<span class="font-display font-bold">{ride.workoutName}</span>
	{#if server?.exportState === 'failed'}
		<!-- The one delivery state worth a mark on the row (#1553): the ride
		     page says why and has the retry. Pending and delivered are the
		     normal course and stay quiet here. -->
		<span class="eyebrow text-danger" title="Open the ride to try again"
			>not on Strava</span
		>
	{/if}
	<span class="text-muted text-xs"
		>{new Date(ride.startedAt).toLocaleDateString()}</span
	>
	<!-- Where it was ridden (#2457): its own item, so the row's gap spaces
	     it and a narrow row wraps it whole. -->
	{#if server?.crew}
		<span class="text-muted text-xs">{ridePlace(server)}</span>
	{/if}
	<!-- How far a road ride went and what it climbed (#3053): the server's
	     replay, on a ride that had a road. -->
	{#if server?.distanceM != null}
		<span class="text-muted num text-xs"
			>{kmAndClimb(server.distanceM, server.climbedM ?? 0)}</span
		>
	{/if}
	<span class="text-muted num ml-auto text-xs">{formatClock(ride.seconds)}</span
	>
	<span class="num text-xs">{ride.avgWatts} W</span>
	<span class="text-muted num text-xs">{ride.kj} kJ</span>
	<!-- A ride whose workout prescribed no target has no execution to show;
	     the dash says so on hover rather than sitting there unexplained. -->
	<span
		class="font-display text-sm font-semibold tabular-nums"
		title={ride.executionScored === false
			? 'This workout had no power targets to score'
			: undefined}
		>{ride.executionScored === false
			? '—'
			: `${Math.round(ride.execution * 100)}%`}</span
	>
	{#if server}
		<!-- Per-ride sharing (ADR-0024): off by default, one tap to flip.
		     The same toggle the ride's own page draws (#2167). -->
		<ShareToggle
			ride={server}
			class="btn btn-ghost btn-xs relative -my-1 -mr-2"
		/>
	{/if}
</li>
