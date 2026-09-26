<script lang="ts">
	// A zone, named by its colour beside words drawn in text colours (#2856).
	// The ramp is fitted to a fill's floor, not a word's (ADR-0023 §3), so it
	// marks and never writes. Size comes in as a class, like ProgressBar's knobs.
	import { ZONE_BG } from './zones';

	let { zone, class: cls = 'size-2' }: { zone: number; class?: string } =
		$props();
</script>

<span
	aria-hidden="true"
	class="inline-block shrink-0 rounded-full {ZONE_BG[zone]} {cls}"
></span>
