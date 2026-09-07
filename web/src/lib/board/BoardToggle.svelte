<script lang="ts">
	/**
	 * The way to the soundboard, in the room's reaction row.
	 *
	 * It has moved twice. First a pill floating over the room, which landed on
	 * the chat composer; then an icon in the sidebar's audio strip, where a
	 * speaker glyph sat beside the mix faders and read as a second volume
	 * control while taking a third of a 240 px row. Firing a clip is what a
	 * cheer is — something you throw into the room — so it lives with the
	 * cheers and draws a drum, not a speaker.
	 */
	import Drum from '@lucide/svelte/icons/drum';
	import { boardPanel } from '$lib/board/panel.svelte';
</script>

<button
	onclick={() => boardPanel.toggle()}
	aria-expanded={boardPanel.open}
	class="flex flex-1 items-center justify-center rounded border py-2 {boardPanel.open
		? 'border-neon/50 text-ink'
		: 'border-muted/20 text-muted hover:border-muted/50 hover:text-ink'}"
	title="your soundboard"
	aria-label="your soundboard"><Drum size={18} /></button
>
