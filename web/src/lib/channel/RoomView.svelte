<script lang="ts">
	// The room with what is shared on its wall: a voice channel's page and a
	// ride's Room view. A phone's wall cannot hold YouTube's 200 × 200, so
	// there the picture hangs above the room (LoungeScene).
	import type { MenuEntry } from '$lib/context-menu.svelte';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { useChannel } from '$lib/channel/context';
	import Stage from '$lib/channel/Stage.svelte';
	import { pickStage, pictureKey } from '$lib/channel/stage';
	import LoungeScene from '$lib/lounge/LoungeScene.svelte';

	let { menuOf }: { menuOf: (id: string) => MenuEntry[] } = $props();

	const channel = useChannel();
	const av = $derived(channelConnection.call?.av);
	const sources = $derived(channel.stageSources);
	const onStage = $derived(pickStage(sources, av?.stagePick ?? null));
</script>

{#snippet picture(height: number)}
	{#if onStage}
		<Stage
			inRoom
			wall={height > 0}
			{sources}
			activeKey={onStage.key}
			trackKey={pictureKey(onStage)}
			height={height || undefined}
			onPick={(key) => channel.pickStage(key)}
			attach={(node) => channel.attachStage(node, onStage.key)}
		/>
	{/if}
{/snippet}

<LoungeScene {menuOf} screen={onStage ? picture : undefined} />
