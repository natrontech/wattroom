<script lang="ts">
	// One fader on one line (#4170): its name in a fixed column, the fader,
	// its value right-aligned. Every row shares the widths, so the names keep
	// one left edge and the values one right edge, mix and riders alike.
	import type { Snippet } from 'svelte';
	import type { Fader } from '$lib/sound/fader';

	let {
		name,
		shown,
		travel,
		value,
		onvalue,
		onrelease,
		aria,
		mark,
	}: {
		name: string;
		/** The value as the rider reads it: "60%", "−20%", "off". */
		shown: string;
		travel: Fader;
		value: number;
		onvalue: (value: number) => void;
		onrelease?: () => void;
		aria?: string;
		/** Drawn after the name, e.g. a rider's status mark. */
		mark?: Snippet;
	} = $props();
</script>

<label class="flex items-center gap-3">
	<span class="flex w-28 shrink-0 items-center gap-1 text-sm">
		<span class="truncate">{name}</span>
		{@render mark?.()}
	</span>
	<input
		type="range"
		{...travel}
		{value}
		oninput={(e) => onvalue(Number(e.currentTarget.value))}
		onchange={onrelease}
		aria-label={aria}
		class="min-w-0 flex-1"
	/>
	<span class="font-display w-11 shrink-0 text-right text-sm tabular-nums"
		>{shown}</span
	>
</label>
