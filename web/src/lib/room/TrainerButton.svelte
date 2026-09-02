<script lang="ts">
	// Pair / unpair, from one definition. It lived inline in the Lounge, which
	// meant a rider who walked into Training with nothing paired saw an
	// instrument reading 0 W and no way to fix it — the pairing affordance was
	// one place away from the only surface that shows you it is missing.
	//
	// The failure travels WITH the button: rideError used to be a paragraph in
	// the Lounge, so the same pair click reported itself in one place and
	// nowhere else. Ride-critical, so it stays put rather than toasting past a
	// rider three meters away (errors.md).
	//
	// Thumb-sized on the 3 m surface (ux.md); Web Bluetooth is Chrome/Edge
	// only, so the button is disabled with a reason rather than failing on
	// click.
	import { dev } from '$app/environment';
	import { useRoom } from '$lib/room/context';

	let { compact = false }: { compact?: boolean } = $props();

	const room = useRoom();
	const supported = $derived(
		typeof navigator !== 'undefined' && !!navigator.bluetooth,
	);
</script>

<div class="flex flex-wrap items-center gap-2">
	{#if !room.trainer}
		<button
			onclick={() => room.pair()}
			disabled={!supported}
			title={supported ? 'Pair trainer' : 'Web Bluetooth needs Chrome or Edge'}
			class="btn btn-secondary {compact ? 'btn-xs' : ''}">Pair trainer</button
		>
		{#if dev}
			<!-- Dev-only (#123): simulated watts in a live room would count for
			     medals, XP and streaks — the fairness layer takes no fakes. -->
			<button onclick={() => room.pairSimulated()} class="btn btn-ghost btn-xs"
				>Ride simulated</button
			>
		{/if}
	{:else}
		<button onclick={() => room.unpair()} class="btn btn-ghost btn-xs"
			>Unpair trainer</button
		>
	{/if}
	{#if room.rideError}
		<p class="text-danger text-xs">{room.rideError}</p>
	{/if}
</div>
