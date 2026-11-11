<script lang="ts">
	/**
	 * The way into the phone remote for a ride alone (#4425): on a phone-width
	 * screen, whatever page it is on, while another of the rider's screens
	 * rides alone. A voice channel's ride offers the same on its own pages
	 * (RemoteOffer.svelte); a ride alone has no page the phone would open, so
	 * the frame carries this one, under the top bar.
	 */
	import { device } from '#lib/device.svelte.ts';
	import PhoneRemote from '#lib/ride/PhoneRemote.svelte';
	import { theRide } from '#lib/ride/the-ride.svelte.ts';
	import { riderLane } from '#lib/rider-lane.svelte.ts';

	let open = $state(false);
	const where = $derived(
		device.narrow && !theRide.live ? riderLane.elsewhere : '',
	);
	// The ride ended or moved here: the remote has nothing to press.
	$effect(() => {
		if (!where) open = false;
	});
</script>

{#if where}
	<div
		class="border-ink/5 flex shrink-0 flex-col gap-2 border-b px-3 py-3"
		data-testid="ride-elsewhere"
	>
		<p class="text-muted text-base">Your ride is on your {where}.</p>
		<button
			type="button"
			class="btn btn-accent btn-ride w-full text-2xl!"
			onclick={() => (open = true)}
		>
			Use as your remote
		</button>
	</div>
	{#if open}
		<PhoneRemote
			link={riderLane}
			social={false}
			onclose={() => (open = false)}
		/>
	{/if}
{/if}
