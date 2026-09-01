<script lang="ts">
	// Moved to $lib/room — the real training place, solo ride and ramp test all
	// use it. Kept as a shim so the mock's imports stay local.
	import SecondaryRow from '$lib/room/SecondaryRow.svelte';
	import type { RoomRider } from '$lib/room/view';

	let {
		you,
		bias,
		small = false,
		onBias,
	}: {
		you: RoomRider;
		bias: number;
		small?: boolean;
		onBias?: (step: number) => void;
	} = $props();
</script>

<SecondaryRow
	cadence={you.cadence}
	hr={you.hr}
	watts={you.watts}
	kg={you.kg}
	{bias}
	{small}
	{onBias}
/>
