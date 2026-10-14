<script lang="ts">
	/**
	 * The bike computer's head (TARGETS ride-road-world 9, the one-home table,
	 * #3668): the 3 s power, the largest number on the screen and the one
	 * figure in watt; W/kg beside it; the live zone under it as digit and
	 * name, never colour alone (#3213); and, while a target is asked, the
	 * target track with its band and how much of this block sat inside it.
	 */
	import TabularFigures from '$lib/components/TabularFigures.svelte';
	import ZoneDot from '$lib/components/ZoneDot.svelte';
	import { ZONE_NAMES, zoneOf } from '$lib/components/zones';
	import { targetState } from '$lib/channel/types';
	import { wkg } from '$lib/format';
	import PowerTrack from '$lib/session/PowerTrack.svelte';
	import { TV_LABEL } from '$lib/session/computer-pages';

	let {
		power,
		kg,
		ftp,
		stale,
		target,
		blockExecution = null,
		tv = false,
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
		/** At three metres (TvMode): SPEC's TV sizes, in vh. */
		tv?: boolean;
	} = $props();

	const shown = $derived(stale ? 0 : power);
	const zone = $derived(zoneOf(shown, ftp));
	const band = $derived(target ? targetState({ watts: shown, target }) : null);
	// v2-erg's window: a fifth of the target either side, to the nearest 5 W,
	// so the band reads as a slot and not a sliver of 0–300 W.
	const round5 = (w: number) => Math.round(w / 5) * 5;
	const lo = $derived(target ? round5(target * 0.8) : 0);
	const hi = $derived(target ? round5(target * 1.2) : 0);
	// ride-label is 24 px, under the TV's 2.9vh floor: the TV spells it in vh.
	const size = $derived(
		tv
			? {
					power: 'text-[22vh]',
					unit: 'text-[6vh]',
					label: TV_LABEL,
					value: 'text-[6vh]',
					words: 'text-[3vh] leading-none',
					dot: 'size-[1.8vh]',
					track: 'mt-[0.5vh] h-[2vh]',
					gap: 'gap-[0.5vh]',
				}
			: {
					power: 'text-[6.5rem]',
					unit: 'text-2xl',
					label: 'ride-label',
					value: 'text-4xl',
					words: 'text-2xl leading-7',
					dot: 'size-3',
					track: 'mt-1 h-3',
					gap: 'gap-2',
				},
	);
</script>

<div data-testid="computer-head" class="flex flex-col {size.gap}">
	<div class="flex flex-wrap items-end justify-between gap-x-2 gap-y-2">
		<p class="num leading-[0.85] font-bold whitespace-nowrap">
			<span
				data-testid="head-power"
				class="{size.power} {stale ? 'text-muted' : 'text-watt glow-text'}"
				><TabularFigures value={stale ? '—' : power} /></span
			>{' '}<span class="text-muted {size.unit} font-normal">W</span>
		</p>
		<div class="pb-1">
			<p class={size.label}>W/kg</p>
			<p data-field="wkg" class="num {size.value} leading-none font-bold">
				{stale ? '—' : wkg(power, kg)}
			</p>
		</div>
	</div>
	{#if shown > 0}
		<!-- Silent at 0 W: Z1 for a rider who stopped is a lie. -->
		<p data-testid="head-zone" class="{size.label} flex items-center gap-2">
			<ZoneDot {zone} class={size.dot} />Z{zone}
			{ZONE_NAMES[zone]}
		</p>
	{/if}
	{#if target && band}
		<PowerTrack
			watts={shown}
			{target}
			{ftp}
			from={lo}
			fullScale={hi}
			needle={!stale}
			class={size.track}
		/>
		<!-- The window's ends, and the band named under itself (v2-erg). -->
		<p class="num text-muted flex justify-between {size.words}">
			<span>{lo}</span>
			<span
				>{target - band.band} · <span class="text-neon">{target}</span> · {target +
					band.band}</span
			>
			<span>{hi} W</span>
		</p>
		{#if blockExecution !== null}
			<!-- Once a second of the block is scored: SPEC scores a steady block
			     with no guard up, so a ramp asks a target and has no share. -->
			<p data-testid="head-block" class="flex items-baseline gap-3">
				<span class={size.label}>Block</span>
				<span class="num {size.value} leading-none font-bold"
					>{stale ? '—' : Math.round(blockExecution * 100)}</span
				><span class="text-muted {size.words}">% on target</span>
			</p>
		{/if}
	{/if}
</div>
