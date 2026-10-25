<script lang="ts">
	/**
	 * The way into the phone remote (#3217): on a phone-width screen that sees
	 * another of the rider's screens hold the trainer (ADR-0025). Beside
	 * TrainerOverview rather than inside it, because a phone with no Web
	 * Bluetooth draws no trainer card at all, and that is the phone that needs
	 * this most.
	 *
	 * The phone is a controller while another of the rider's screens carries
	 * their voice (ADR-0089): it says where the voice is, and the one tap that
	 * moves it here.
	 */
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { device } from '$lib/device.svelte';
	import PhoneRemote from '$lib/ride/PhoneRemote.svelte';

	let { class: cls = '' }: { class?: string } = $props();

	let open = $state(false);
	const conn = $derived(channelConnection.current);
	const live = $derived(conn?.live);
	const offered = $derived(device.narrow && !!live?.pairing.elsewhere?.trainer);
	const voiceElsewhere = $derived(
		device.narrow ? (live?.pairing.elsewhere?.voice ?? '') : '',
	);
	const joining = $derived(conn?.av.status === 'connecting');
</script>

{#if (offered || voiceElsewhere) && live}
	<div class="flex w-full flex-col gap-2 {cls}" data-testid="controller">
		{#if offered}
			<button
				type="button"
				class="btn btn-accent btn-ride w-full text-2xl!"
				onclick={() => (open = true)}
			>
				Use this phone as your remote
			</button>
		{/if}
		{#if voiceElsewhere}
			<p class="text-ink-muted text-base">
				Your voice is on your {voiceElsewhere}.
			</p>
			<button
				type="button"
				class="btn btn-accent btn-ride w-full text-2xl!"
				disabled={joining}
				onclick={() => void conn?.av.join({ take: true })}
			>
				Use this device for voice
			</button>
		{/if}
	</div>
	{#if open}
		<PhoneRemote {live} onclose={() => (open = false)} />
	{/if}
{/if}
