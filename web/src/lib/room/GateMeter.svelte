<script lang="ts">
	import {
		GATE_MAX_DB,
		GATE_MIN_DB,
		gateDb,
		gateLevel,
		gatePct,
	} from '$lib/room/gate-scale';

	let {
		level = 0,
		effective,
		setting = effective,
		transmitting = false,
		onThreshold,
		class: cls = '',
		title,
	}: {
		/** Own mic level this instant, analyser RMS 0..1. */
		level?: number;
		/** The threshold actually gating you — doubled while music plays. */
		effective: number;
		/** The threshold you set, when it can differ from the effective one. */
		setting?: number;
		/** The gate's verdict right now: is audio leaving this machine? */
		transmitting?: boolean;
		/** Given, the meter's track becomes the threshold slider. */
		onThreshold?: (threshold: number) => void;
		class?: string;
		title?: string;
	} = $props();

	/**
	 * The slider thumb (app.css, 14 px) travels between its own half-widths,
	 * so the meter is inset by exactly that half: a level and a threshold of
	 * the same value then land on the same pixel, which is the whole point.
	 */
	const HALF_THUMB = 7;
	const travel = (pct: number) =>
		`calc(${HALF_THUMB}px + (100% - ${2 * HALF_THUMB}px) * ${pct / 100})`;

	// Only worth a mark of its own when it is somewhere the thumb is not.
	const marked = $derived(!onThreshold || effective !== setting);
</script>

<div class="relative {onThreshold ? 'h-5' : 'h-2.5'} {cls}" {title}>
	<div
		class="bg-muted/25 absolute top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full"
		style="left: {HALF_THUMB}px; right: {HALF_THUMB}px"
	>
		<div
			class="h-full rounded-full {transmitting
				? 'bg-z4'
				: 'bg-muted/60'} transition-[width] duration-100"
			style="width: {gatePct(level)}%"
		></div>
	</div>
	{#if marked}
		<!-- The gate, on the level's own scale. -->
		<div
			class="bg-ink/70 absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
			style="left: {travel(gatePct(effective))}"
		></div>
	{/if}
	{#if onThreshold}
		<input
			type="range"
			class="gate-slider absolute inset-0 m-0 w-full"
			min={GATE_MIN_DB}
			max={GATE_MAX_DB}
			step="1"
			value={Math.round(gateDb(setting))}
			oninput={(e) => onThreshold(gateLevel(Number(e.currentTarget.value)))}
			aria-label="gate threshold"
			aria-valuetext="{Math.round(gateDb(setting))} decibels"
		/>
	{/if}
</div>
