<script lang="ts">
	// The one ⚑ (#52, #2180): one tap, no dialog, keep pedalling. Three
	// surfaces had drawn this button themselves — the same 44×56 outline,
	// the same icon — and only the session's carried the consent the tap needs.
	// The phone remote's Flag is this button (ride-controls.ts): it is
	// offered while the button is live, and counted when it takes.
	import { tooltip } from '$lib/tooltip.svelte';
	import { CONTROLS } from './ride-controls';
	import { rideOffers } from './ride-offers.svelte';
	import { FLAG_ASKS } from './flag';

	let {
		onflag,
		sends,
		disabled = false,
	}: {
		onflag: () => void;
		/** Whether the tap sends (a session) or marks for the summary (solo). */
		sends: 'now' | 'after';
		disabled?: boolean;
	} = $props();

	const { label, icon: Icon } = CONTROLS.flag;
	function press() {
		onflag();
		rideOffers.flagged();
	}
	$effect(() => (disabled ? undefined : rideOffers.offer('flag', press)));
</script>

<button
	onclick={press}
	{disabled}
	{@attach tooltip(label, FLAG_ASKS[sends])}
	class="border-neon/40 text-neon hover:bg-neon/10 grid h-11 w-14 shrink-0 place-items-center rounded border disabled:opacity-40 max-md:w-auto max-md:flex-1"
	aria-label={label}><Icon size={18} /></button
>
