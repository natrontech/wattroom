<script lang="ts">
	/**
	 * One of the ride's controls in the now bar (ride-controls.ts): a 44 px
	 * icon, named and with the app's tooltip, and with the hint as its
	 * tooltip's second line while it waits (#4427). The phone remote draws the
	 * same control from the same list. `offer` hands it to the phone while
	 * it is live: the phone's TV is this button.
	 */
	import { tooltip } from '$lib/tooltip.svelte';
	import { CONTROLS, type RideControl } from './ride-controls';
	import { rideOffers, type Offered } from './ride-offers.svelte';

	let {
		control,
		onclick,
		disabled = false,
		hint,
		pressed,
		offer,
		box = 'h-11 w-11',
		class: extra = '',
	}: {
		control: RideControl;
		onclick: () => void;
		disabled?: boolean;
		/** Why it waits, while it does. */
		hint?: string;
		/** A toggle's state. */
		pressed?: boolean;
		/** The phone action this button runs for the remote. */
		offer?: Offered;
		/** The button's size, as its bar's other icons have it. */
		box?: string;
		class?: string;
	} = $props();

	const meta = $derived(CONTROLS[control]);
	$effect(() =>
		offer && !disabled ? rideOffers.offer(offer, onclick) : undefined,
	);
</script>

<button
	{onclick}
	{disabled}
	aria-label={meta.label}
	aria-pressed={pressed}
	class="btn btn-secondary {box} shrink-0 p-0 {extra}"
	{@attach tooltip(meta.label, disabled ? hint : undefined)}
	><meta.icon size={20} /></button
>
