<script lang="ts">
	// The view switch's Room: you pedal in the cozy room with your numbers over
	// it. Loaded on demand: a solo ride never draws it. A figure's menu here is
	// what every person in WattRoom offers.
	import { goto } from '$app/navigation';
	import { useChannel } from '$lib/channel/context';
	import { personMenu } from '$lib/person-menu';

	const channel = useChannel();
	const menuOf = (id: string) =>
		personMenu(id, goto, { you: channel.you.id === id });
</script>

{#await import('$lib/channel/RoomView.svelte') then { default: RoomView }}
	<div class="flex min-h-0 flex-1 flex-col">
		<RoomView {menuOf} />
	</div>
{/await}
