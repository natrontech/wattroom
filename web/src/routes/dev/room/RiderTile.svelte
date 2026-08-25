<script lang="ts">
	import {
		ZONE_BG,
		ZONE_TEXT,
		type MockRider,
		zoneOf,
	} from './mockRoom.svelte';

	let { rider }: { rider: MockRider } = $props();

	const zone = $derived(zoneOf(rider.watts, rider.ftp));
	const pctFtp = $derived(Math.round((rider.watts / rider.ftp) * 100));
	const wkg = $derived((rider.watts / rider.kg).toFixed(1));
	// Bar fills at 150 % FTP, matching the interval graph's ceiling.
	const fill = $derived(Math.min(100, (rider.watts / rider.ftp / 1.5) * 100));
</script>

<div class="border-muted/15 bg-surface-raised rounded-lg border p-4">
	<div class="flex items-center justify-between gap-2">
		<span class="truncate text-sm font-medium">{rider.name}</span>
		{#if rider.coach}
			<span
				class="border-muted/25 text-muted shrink-0 rounded-full border px-2 py-0.5 text-[10px]"
				>coach</span
			>
		{/if}
	</div>

	<div class="mt-3 flex items-baseline gap-1.5">
		<span class="font-display text-4xl leading-none font-bold tabular-nums"
			>{rider.watts}</span
		>
		<span class="text-muted text-xs">W</span>
		<span class="text-muted ml-auto font-mono text-xs tabular-nums"
			>{pctFtp}%</span
		>
	</div>

	<div class="bg-surface mt-2 h-1.5 overflow-hidden rounded-full">
		<div
			class="h-full rounded-full {ZONE_BG[zone]}"
			style="width: {fill}%"
		></div>
	</div>

	<div
		class="text-muted mt-3 flex items-center gap-3 font-mono text-[11px] tabular-nums"
	>
		<span>{wkg} w/kg</span>
		<span>{rider.cadence} rpm</span>
		<span>{rider.hr} bpm</span>
		<span class="ml-auto {ZONE_TEXT[zone]}">Z{zone}</span>
	</div>
</div>
