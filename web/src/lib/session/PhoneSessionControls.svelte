<script lang="ts">
	/**
	 * A session's controls on a phone (#4233), in slot 1 as a solo phone
	 * ride's are: full-width rows of equal buttons, no label wrapping (TARGETS
	 * phone-ride 5), the remote's offer its own row under them.
	 */
	import { useChannel } from '$lib/channel/context';
	import RemoteOffer from '$lib/ride/RemoteOffer.svelte';
	import SessionControls from '$lib/session/SessionControls.svelte';
	import SessionFlag from '$lib/session/SessionFlag.svelte';
	import ViewSwitch from '$lib/world/ViewSwitch.svelte';
	import type { createWorldView } from '$lib/world/world-view.svelte';

	let {
		world,
		onLeave,
	}: {
		world: ReturnType<typeof createWorldView>;
		onLeave: () => void;
	} = $props();

	const channel = useChannel();
</script>

<div class="flex flex-col gap-2">
	<div
		class="flex flex-wrap items-center gap-2 [&_button]:whitespace-nowrap [&>*]:grow"
	>
		<SessionControls compact />
		{#if channel.ridden}<ViewSwitch
				{world}
				drawn={world.band && !!channel.ridden}
			/>{/if}
		<SessionFlag />
		{#if channel.you.inSession}
			<button onclick={onLeave} class="btn btn-secondary btn-ride"
				>Leave the ride</button
			>
		{/if}
	</div>
	<RemoteOffer />
</div>
