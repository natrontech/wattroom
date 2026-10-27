<script lang="ts">
	/**
	 * A session's actions on a phone (#4233), the last panel of its column
	 * as v2-phone's riding screen ends on Talk and Leave the ride: the view
	 * switch across, then ⚑ and Leave as equal halves, the remote's offer,
	 * and the coach's controls last after a separator, End among them (G8).
	 * Every button at least 44 px, no label wrapping (TARGETS phone-ride 5).
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
	const ROW = '[&_button]:min-h-[44px] [&_button]:whitespace-nowrap';
</script>

<div class="flex flex-col gap-3 p-4">
	{#if channel.ridden}
		<div class="{ROW} [&_button]:flex-1 [&>div]:w-full">
			<ViewSwitch {world} drawn={world.band && !!channel.ridden} />
		</div>
	{/if}
	<div class="{ROW} grid grid-cols-2 gap-3 [&_button]:w-full">
		<div><SessionFlag /></div>
		{#if channel.you.inSession}
			<button onclick={onLeave} class="btn btn-secondary btn-ride"
				>Leave the ride</button
			>
		{/if}
	</div>
	<RemoteOffer />
	<div
		class="{ROW} border-ink/10 flex flex-wrap gap-2 border-t pt-3 [&:not(:has(*))]:hidden [&>*]:grow"
	>
		<SessionControls compact />
	</div>
</div>
