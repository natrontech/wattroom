<script lang="ts">
	// Moved to $lib/room — the real training place, solo ride and ramp test all
	// use it. Kept as a shim so the mock's imports stay local.
	import Instrument from '$lib/room/Instrument.svelte';
	import type { RoomRider } from '$lib/room/view';

	let {
		you,
		compact = false,
		targetLabel = 'target',
	}: { you: RoomRider; compact?: boolean; targetLabel?: string } = $props();
</script>

<Instrument
	watts={you.watts}
	target={you.target}
	ftp={you.ftp}
	{compact}
	{targetLabel}
/>
