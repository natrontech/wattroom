<script lang="ts">
	// A ride that never reached the account, said where WattRoom opens (#2616).
	// The only offer used to sit at the foot of /ride's setup screen, under the
	// FTP field: a rider who rides sessions, or does not scroll, never saw it,
	// and the ride stayed in one browser's storage for good. Persistent, not a
	// toast (errors.md), until Rides takes it.
	import Banner from '$lib/components/Banner.svelte';
	import { recoverableRides } from '$lib/ride/recoverable.svelte';

	// The signed-in rider's own (#2805): another account's ride on this
	// browser is not one this rider lost.
	const rides = recoverableRides();
	const waiting = $derived(rides.all.length);
</script>

{#if waiting > 0}
	<div class="mt-6">
		<Banner tone="warn">
			{waiting === 1 ? 'A ride' : `${waiting} rides`} never reached your account.
			This browser kept {waiting === 1 ? 'it' : 'them'} — save or download from Rides.
			{#snippet action()}
				<a href="/history" class="btn-link text-xs">Open Rides</a>
			{/snippet}
		</Banner>
	</div>
{/if}
