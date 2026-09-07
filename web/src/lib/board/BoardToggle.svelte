<script lang="ts">
	/**
	 * The way to the soundboard, in the row the room already keeps for sound.
	 *
	 * It began as a pill floating over the room, which was a way of avoiding
	 * this file rather than a design: it landed on the chat composer and read
	 * as something bolted on. `QuickAudio` sets the pattern this follows —
	 * an icon among the mic and the camera when the strip is there, a labelled
	 * button when it is not.
	 */
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import { boardPanel } from '$lib/board/panel.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';

	// `compact` is the sidebar's icon row, the same word QuickAudio uses.
	let { compact = false }: { compact?: boolean } = $props();

	// A board needs a room to fire into, and nothing else — not voice, so this
	// does not follow `showAv`.
	const inRoom = $derived(!!roomConnection.current);
</script>

{#if inRoom}
	<button
		onclick={() => boardPanel.toggle()}
		aria-expanded={boardPanel.open}
		class={compact
			? `flex flex-1 justify-center rounded py-1.5 ${boardPanel.open ? 'text-ink' : 'text-muted/50 hover:text-muted'}`
			: 'btn btn-secondary btn-xs mt-2 w-full'}
		title="your soundboard"
		aria-label="your soundboard"
		>{#if compact}<Volume2 size={16} />{:else}<Volume2 size={13} /> Soundboard{/if}</button
	>
{/if}
