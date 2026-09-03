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
	import { account } from '$lib/account.svelte';
	import { device } from '$lib/device.svelte';
	import { useRoom } from '$lib/room/context';
	import { deviceWord } from '$lib/room/sensor-claim';
	import { pairedElsewhere } from '$lib/room/sensor-status';

	let { compact = false }: { compact?: boolean } = $props();

	const room = useRoom();
	// Another of this rider's screens holds the trainer (#610). Pairing a
	// second one here would connect and then be ignored — the hub takes
	// samples only from the screen holding the claim — so the button gives way
	// to the reason (ux.md: say why, never a dead click).
	const elsewhere = $derived(
		pairedElsewhere('trainer', room.pairing, deviceWord()),
	);
	const supported = $derived(
		typeof navigator !== 'undefined' && !!navigator.bluetooth,
	);
	// Dev-only (#123): simulated watts in a live room would count for medals,
	// XP and streaks, and the fairness layer takes no fakes. `dev` alone also
	// kept it out of the two-rider e2e (#418), which rides a production BUILD
	// — so the gate is the server instead: one that offers the dev sign-in
	// door (WATTROOM_DEV_LOGIN) is a dev server. Production never opens that
	// door, which makes this stricter than the `?sim=1` escape the solo ride
	// screen carries — that one any rider can type.
	const canSimulate = $derived(dev || account.providers.includes('dev'));
</script>

<!-- Phones are spectators (WATTROOM.md, locked) — there is no trainer to
     pair and no reason to draw the question. Gated HERE rather than at each
     call site, so the Lounge, Training and whatever comes next all inherit it
     (#412). -->
{#if !device.spectator}
	<div class="flex flex-wrap items-center gap-2">
		{#if elsewhere && !room.trainer}
			<!-- The rider's own equipment, on their own other screen: say which
			     one rather than offering a pairing the hub would refuse. -->
			<p class="text-muted text-xs">
				Trainer paired {elsewhere}
			</p>
		{:else if !room.trainer}
			<button
				onclick={() => room.pair()}
				disabled={!supported}
				title={supported
					? 'Pair trainer'
					: 'Web Bluetooth needs Chrome or Edge'}
				class="btn btn-secondary {compact ? 'btn-xs' : ''}">Pair trainer</button
			>
			{#if canSimulate}
				<!-- Dev-only (#123): simulated watts in a live room would count for
				     medals, XP and streaks — the fairness layer takes no fakes. -->
				<button
					onclick={() => room.pairSimulated()}
					class="btn btn-ghost btn-xs">Ride simulated</button
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
{/if}
