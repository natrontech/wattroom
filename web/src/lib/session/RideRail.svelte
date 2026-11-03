<script lang="ts">
	/**
	 * The ride's glance (the ride HUD, 2026-11): one row of numbers on the
	 * world, no panel, read left to right in the same order on every ride.
	 * Watts first; then a workout's time left and what is next, or a road's
	 * grade and what it does ahead; then speed and distance on a road, and
	 * cadence, heart and the ride's time always. A tap on the rail adds its
	 * second row, the power details, in the same type.
	 *
	 * Three sizes and one label: the watts, the one number beside them, and
	 * every other number. Sized in vh, the TV's column, so it reads at three
	 * metres on any window (docs/spec/riding.md).
	 */
	import { untrack, type Snippet } from 'svelte';
	import { ZONE_BG, ZONE_NAMES, zoneOf } from '$lib/components/zones';
	import { formatClock, wkg } from '$lib/format';
	import { pulse } from '$lib/motion/transitions';
	import type { LiveStats } from '$lib/ride/live-stats.svelte';
	import { aheadLine } from '$lib/ride/road-readout';
	import type { RoadReadout } from '$lib/road/readout';
	import { computerShown } from '$lib/session/computer-shown.svelte';
	import PowerTrack from '$lib/session/PowerTrack.svelte';
	import { nextText, type Block } from '$lib/workout/block';

	let {
		watts,
		stale = false,
		target = 0,
		ftp,
		kg = 0,
		stats,
		block = null,
		road,
		grade,
		speedKph,
		cadence,
		hr,
		elapsed,
		gear,
		status,
		strip,
		title = '',
		more,
		children,
	}: {
		/** The 3 s power. */
		watts: number;
		/** Nothing measured: the numbers go to a dash and lose their glow. */
		stale?: boolean;
		/** The block's target watts; 0 while none is asked. */
		target?: number;
		ftp: number;
		/** For W/kg in the details. */
		kg?: number;
		/** The ride's live stats, for the details. */
		stats?: LiveStats;
		block?: Block | null;
		/** Where on a road: the grade, the grade ahead, the distance. */
		road?: RoadReadout;
		/** Off a road, the grade the rider set (a free ride's − and +). */
		grade?: number;
		/** The dot's speed on a road, in km/h. */
		speedKph?: number;
		cadence: number;
		hr: number;
		/** The ride's time, in seconds. */
		elapsed: number;
		/** The virtual gear, while one shifts. */
		gear?: string;
		/** The ride's persistent status line, while one holds. */
		status?: Snippet;
		/** The workout's strip over the world. */
		strip?: Snippet;
		/** The ride's name, the details row's first word: the road or the workout. */
		title?: string;
		/** The details row's controls: a session's HR share and execution meter. */
		more?: Snippet;
		/** A line under the numbers that stays in view: a race's radio, a ride's notes. */
		children?: Snippet;
	} = $props();

	const dash = (v: string) => (stale ? '—' : v);
	// v2-erg's window round the target, as the head draws it.
	const round5 = (w: number) => Math.round(w / 5) * 5;
	const ahead = $derived(road ? aheadLine(road) : null);
	const hasGrade = $derived(!!road || grade !== undefined);
	// The last three seconds of a block light its clock (v2-erg's 3-2-1).
	const counting = $derived(!!block && block.secondsLeft <= 3);
	const left = $derived(
		road && road.toTopM !== undefined
			? { label: 'To top', m: road.toTopM }
			: road
				? { label: 'To go', m: (road.totalKm - road.km) * 1000 }
				: null,
	);
	const km = (m: number) =>
		m < 1000
			? { value: `${Math.round(m / 100) * 100}`, unit: 'm' }
			: { value: (m / 1000).toFixed(1), unit: 'km' };
	const details = $derived(computerShown.details);
	// The zone you ride in now: none while nothing is measured or at 0 W.
	const zone = $derived(
		stale || watts <= 0 || ftp <= 0 ? 0 : zoneOf(watts, ftp),
	);

	// The gear pulses once when it changes (ADR-0084), never on arrival.
	let gearNode = $state<HTMLElement>();
	let gearSeen = untrack(() => gear);
	$effect(() => {
		if (gear === gearSeen) return;
		gearSeen = gear;
		pulse(gearNode);
	});

	// SPEC's TV column, never under the desk's floors, and on a phone never
	// past its width: the watts, the one beside them, every other number.
	const HERO = 'text-[min(max(4.75rem,12vh),22vw)]';
	const TWO = 'text-[min(max(3.25rem,9vh),15vw)]';
	const SEC = 'text-[min(max(1.5rem,5vh),7.5vw)]';
	const WORDS = 'text-[min(max(0.875rem,2.6vh),5vw)] leading-tight';
	const LABEL =
		'text-muted text-[max(11px,1.7vh)] leading-none font-semibold tracking-[0.1em] whitespace-nowrap uppercase';
	const UNIT = 'text-muted ml-[0.15em] text-[0.42em] font-semibold';
	const NUM = 'font-display block leading-[0.9] font-bold tabular-nums';
	// One cell: its label over its number, the same on every cell.
	const CELL = 'flex min-w-0 flex-col gap-[0.8vh]';
	// The rest, one grid on a phone, one row on a desk.
	const ROW =
		'grid grid-cols-3 items-end gap-x-4 gap-y-[1.5vh] md:flex md:flex-wrap md:gap-x-[max(1.5rem,2.6vw)]';
	// The first row's rest never wraps cell by cell: short of room, it moves
	// under the pair whole.
	const REST = ROW.replace('md:flex-wrap', 'md:flex-nowrap');
</script>

{#snippet cell(label: string, value: string, unit = '', testid?: string)}
	<div class={CELL} data-cell={label}>
		<span class={LABEL}>{label}</span>
		<span data-testid={testid} class="{NUM} {SEC} text-ink min-w-[2.6ch]"
			>{value}{#if unit}<span class={UNIT}>{unit}</span>{/if}</span
		>
	</div>
{/snippet}

{#snippet gradeCell(size: string)}
	<div class={CELL} data-cell="Grade">
		<span class={LABEL}>Grade</span>
		<span data-testid="rail-grade" class="{NUM} {size} text-ink"
			>{(road?.grade ?? grade ?? 0).toFixed(1)}<span class={UNIT}>%</span></span
		>
	</div>
{/snippet}

<div data-testid="ride-rail" class="flex flex-col gap-[1.6vh] py-1">
	{#if status}
		<!-- Above the tap's button: a status line may hold one of its own. -->
		<div class="relative z-10 [&:not(:has(*))]:hidden">{@render status()}</div>
	{/if}
	<div
		class="flex flex-col gap-[1.6vh] md:flex-row md:flex-wrap md:items-end md:gap-x-[max(1.5rem,2.6vw)]"
	>
		<!-- The pair: the watts and the one number a rider reads beside them. -->
		<div class="flex items-end justify-between gap-x-[max(1.5rem,2.6vw)]">
			<div class={CELL} data-cell="Watts">
				<span class={LABEL}
					>Watts{#if target > 0}
						· <span class="text-neon">{target}</span>{:else if zone}
						· Z{zone} {ZONE_NAMES[zone]}{/if}</span
				>
				<span
					data-testid="rail-watts"
					class="{NUM} {HERO} min-w-[2.6ch] {stale
						? 'text-muted'
						: 'text-watt glow-text'}">{dash(`${Math.round(watts)}`)}</span
				>
				{#if target > 0}
					<PowerTrack
						watts={stale ? 0 : watts}
						{target}
						{ftp}
						from={round5(target * 0.8)}
						fullScale={round5(target * 1.2)}
						needle={!stale}
						class="h-[max(6px,0.9vh)]"
					/>
				{:else if ftp > 0}
					<!-- The seven zones in a row, yours lit (Zwift's power bar). -->
					<div
						data-testid="rail-zones"
						role="img"
						aria-label={zone ? `zone ${zone}, ${ZONE_NAMES[zone]}` : 'no zone'}
						class="flex h-[max(6px,0.9vh)] gap-[3px]"
					>
						{#each [1, 2, 3, 4, 5, 6, 7] as z (z)}
							<span
								class="{ZONE_BG[z]} flex-1 rounded-sm {z === zone
									? ''
									: 'opacity-25'}"
							></span>
						{/each}
					</div>
				{/if}
			</div>
			{#if block}
				<div class={CELL} data-cell="Time left">
					<span class={LABEL}
						>{block.label || 'Block'} · {block.index}/{block.count}</span
					>
					<span
						data-testid="rail-left"
						class="{NUM} {TWO} min-w-[4.4ch] {counting
							? 'text-neon'
							: 'text-ink'}">{formatClock(block.secondsLeft)}</span
					>
				</div>
			{:else if hasGrade}
				{@render gradeCell(TWO)}
			{/if}
		</div>
		<div class={REST}>
			{#if block?.next}
				<div class="{CELL} col-span-3 md:max-w-[24ch]" data-cell="Next">
					<span class={LABEL}>Next</span>
					<span data-testid="rail-next" class="{WORDS} text-ink font-semibold"
						>{nextText(block.next)}</span
					>
				</div>
			{:else if ahead && !block}
				<div class="{CELL} col-span-3 md:max-w-[12ch]" data-cell="Ahead">
					<span class={LABEL}>Ahead</span>
					<span data-testid="rail-ahead" class="{WORDS} text-ink font-semibold"
						>{ahead}</span
					>
				</div>
			{/if}
			{#if block && hasGrade}{@render gradeCell(SEC)}{/if}
			{#if speedKph !== undefined && !block}
				{@render cell('Speed', dash(speedKph.toFixed(1)), 'km/h')}
			{/if}
			{#if left && !block}
				{@const d = km(left.m)}
				{@render cell(left.label, d.value, d.unit)}
			{/if}
			{@render cell('Cadence', dash(`${cadence}`), 'rpm')}
			{#if hr > 0}{@render cell('Heart', dash(`${hr}`), 'bpm')}{/if}
			{@render cell('Time', formatClock(elapsed), '', 'ride-clock')}
			{#if gear}
				<div class={CELL} data-cell="Gear">
					<span class={LABEL}>Gear</span>
					<span
						bind:this={gearNode}
						aria-live="polite"
						class="{NUM} {SEC} text-neon">{gear.replace(/^Gear /, '')}</span
					>
				</div>
			{/if}
		</div>
	</div>
	{#if details}
		<!-- The second row, a tap away: the same cells, the power's details. -->
		<div data-testid="rail-details" class={ROW}>
			{#if title}
				<div class="{CELL} col-span-3 md:max-w-[24ch]" data-cell="Ride">
					<span class={LABEL}>Ride</span>
					<span class="{WORDS} text-ink font-semibold">{title}</span>
				</div>
			{/if}
			{#if kg > 0}{@render cell('W/kg', dash(wkg(watts, kg)))}{/if}
			{#if ftp > 0}{@render cell('Zone', dash(`Z${zoneOf(watts, ftp)}`))}{/if}
			{#if stats?.seconds}
				{@render cell('10 s', dash(`${stats.power10}`), 'W')}
				{@render cell('30 s', dash(`${stats.power30}`), 'W')}
				{@render cell('NormPower', `${stats.normPower}`, 'W')}
				{@render cell('Intensity', stats.intensity.toFixed(2))}
				{@render cell('Work', `${stats.kj}`, 'kJ')}
			{/if}
			{#if more}
				<!-- Above the tap's button: these are controls. -->
				<div class="relative z-10 col-span-3 flex items-end gap-4">
					{@render more()}
				</div>
			{/if}
		</div>
	{/if}
	{#if strip}<div class="h-[max(2rem,4vh)]">{@render strip()}</div>{/if}
	{#if children}
		<div
			class="relative z-10 flex flex-wrap gap-x-4 {WORDS} [&:not(:has(*))]:hidden"
		>
			{@render children()}
		</div>
	{/if}
</div>
