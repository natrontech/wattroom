<script lang="ts">
	// No thread picked: the right column teaches what this place is. Below
	// md the layout shows the list instead of this.
	import { MessagesSquare } from '@lucide/svelte';
</script>

<div class="text-muted grid flex-1 place-items-center px-6 text-center">
	<div class="max-w-sm">
		<MessagesSquare size={28} class="mx-auto opacity-60" />
		<p class="font-display text-ink mt-3 text-base font-bold">Messages</p>
		<p class="mt-1 text-sm">
			Every room's chat and your notes between friends, in one list. Pick one on
			the left — a room's chat reads and writes from here without joining the
			room.
		</p>
	</div>
</div>
