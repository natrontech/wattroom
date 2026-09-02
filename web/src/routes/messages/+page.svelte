<script lang="ts">
	// No thread picked: teach where the list is. The sidebar IS the list
	// (#484) — this page never repeats it. Below md the layout shows the
	// thread list instead of this, because the sidebar is a drawer there.
	import { MessagesSquare } from '@lucide/svelte';
</script>

<div class="text-muted grid flex-1 place-items-center px-6 text-center">
	<div class="max-w-sm">
		<MessagesSquare size={28} class="mx-auto opacity-60" />
		<p class="font-display text-ink mt-3 text-base font-bold">Messages</p>
		<p class="mt-1 text-sm">
			Every room's chat and your notes between friends. Pick a friend in the
			sidebar, or right-click one of your rooms and read its chat — from here a
			room reads and writes without joining it.
		</p>
	</div>
</div>
