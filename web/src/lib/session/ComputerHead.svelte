<script lang="ts">
	/**
	 * The bike computer's head (TARGETS ride-road-world 9, the one-home table,
	 * #3668): the 3 s power, the largest number on the screen and the one
	 * figure in watt; W/kg beside it; the live zone under it as digit and
	 * name, never colour alone (#3213); and, while a target is asked, the
	 * target track with its band and how much of this block sat inside it.
	 */
	import ZoneDot from '$lib/components/ZoneDot.svelte';
	import { ZONE_NAMES, zoneOf } from '$lib/components/zones';
	import { targetState } from '$lib/channel/types';
	import { wkg } from '$lib/format';
	import PowerTrack from '$lib/session/PowerTrack.svelte';

	let {
		power,
		kg,
		ftp,
		stale,
		target,
		blockExecution = null,
	}: {
		/** The 3 s power, or this second's watts before three have passed. */
		power: number;
		kg: number;
		ftp: number;
		/** Nothing is measured (#2851): no number keeps its watt or glow. */
		stale: boolean;
		/** The block's target watts; absent while none is asked. */
		target?: number;
		/** The block's scored seconds inside the band, 0–1; null until one is scored. */
		blockExecution?: number | null;
	} = $props();

	const shown = $derived(stale ? 0 : power);
	const zone = $derived(zoneOf(shown, ftp));
	const band = $derived(target ? targetState({ watts: shown, target }) : null);
</script>

<div data-testid="computer-head" class="flex flex-col gap-2">
	<div class="flex flex-wrap items-end gap-x-6 gap-y-2">
		<p class="num leading-[0.85] font-bold whitespace-nowrap">
			<span
				data-testid="head-power"
				class="text-[6.5rem] {stale ? 'text-muted' : 'text-watt glow-text'}"
				>{stale ? '—' : power}</span
			>{' '}<span class="text-muted text-5xl font-normal">W</span>
		</p>
		<div class="pb-1">
			<p class="ride-label">W/kg</p>
			<p data-field="wkg" class="num text-4xl leading-none font-bold">
				{stale ? '—' : wkg(power, kg)}
			</p>
		</div>
	</div>
	{#if shown > 0}
		<!-- Silent at 0 W: Z1 for a rider who stopped is a lie. -->
		<p data-testid="head-zone" class="ride-label flex items-center gap-2">
			<ZoneDot {zone} class="size-3" />Z{zone}
			{ZONE_NAMES[zone]}
		</p>
	{/if}
	{#if target && band}
		<PowerTrack watts={shown} {target} {ftp} class="mt-1 h-3" />
		<p class="num text-muted flex justify-between text-2xl leading-7">
			<span>{target - band.band}</span>
			<span class="text-neon">{target} W</span>
			<span>{target + band.band}</span>
		</p>
		{#if blockExecution !== null}
			<p data-testid="head-block" class="flex items-baseline gap-3">
				<span class="ride-label">Block</span>
				<span class="num text-4xl leading-none font-bold"
					>{Math.round(blockExecution * 100)}</span
				><span class="text-muted text-2xl">% on target</span>
			</p>
		{/if}
	{/if}
</div>
