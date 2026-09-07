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
	 *
	 * Labelled rather than a fifth glyph in that row: a bare drum among four
	 * reaction faces reads as a fifth reaction, and the first rider to see it
	 * there could not find the board at all. `Away` in the sidebar is the same
	 * shape — a toggle that says what it is, primary while it is on.
	 */
	import Drum from '@lucide/svelte/icons/drum';
	import { boardPanel } from '$lib/board/panel.svelte';
</script>

<button
	onclick={() => boardPanel.toggle()}
	aria-expanded={boardPanel.open}
	class="btn btn-xs mt-1.5 w-full {boardPanel.open
		? 'btn-primary'
		: 'btn-secondary'}"
	title="your soundboard"><Drum size={13} /> Soundboard</button
>
