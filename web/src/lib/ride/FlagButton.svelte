<script lang="ts">
	// The one ⚑ (#52, #2180): one tap, no dialog, keep pedalling. Three
	// surfaces had drawn this button themselves — the same 44×56 outline,
	// the same icon — and only the room's carried the consent the tap needs.
	import Flag from '@lucide/svelte/icons/flag';
	import { FLAG_ASKS } from './flag';

	let {
		onflag,
		sends,
		disabled = false,
	}: {
		onflag: () => void;
		/** Whether the tap sends (a room) or marks for the summary (solo). */
		sends: 'now' | 'after';
		disabled?: boolean;
	} = $props();
</script>

<button
	onclick={onflag}
	{disabled}
	title={FLAG_ASKS[sends]}
	class="border-neon/40 text-neon hover:bg-neon/10 grid h-11 w-14 shrink-0 place-items-center rounded border disabled:opacity-40"
	aria-label="Flag a problem"><Flag size={18} /></button
>
