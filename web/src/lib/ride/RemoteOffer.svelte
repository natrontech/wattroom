<script lang="ts">
	/**
	 * The way into the phone remote (#3217): on a phone-width screen that sees
	 * another of the rider's screens hold the trainer (ADR-0025). Beside
	 * TrainerOverview rather than inside it, because a phone with no Web
	 * Bluetooth draws no trainer card at all, and that is the phone that needs
	 * this most.
	 */
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { device } from '$lib/device.svelte';
	import PhoneRemote from '$lib/ride/PhoneRemote.svelte';

	let { class: cls = '' }: { class?: string } = $props();

	let open = $state(false);
	const live = $derived(channelConnection.current?.live);
	const offered = $derived(device.narrow && !!live?.pairing.elsewhere?.trainer);
</script>

{#if offered && live}
	<button
		type="button"
		class="btn btn-accent btn-ride w-full text-2xl! {cls}"
		onclick={() => (open = true)}
	>
		Use this phone as your remote
	</button>
	{#if open}
		<PhoneRemote {live} onclose={() => (open = false)} />
	{/if}
{/if}
