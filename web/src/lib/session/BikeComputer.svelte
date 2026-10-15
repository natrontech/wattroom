<script lang="ts">
	/**
	 * Slot 3, your numbers, as a bike computer (ADR-0071, #3088): a few fixed
	 * pages, turned by ← and →, a tap on the panel or a page dot. It starts
	 * on RIDE with every ride, because it mounts with every ride.
	 *
	 * Sizes are docs/SPEC.md's legibility budget at the design distance:
	 * secondary numbers 36 px on a desk and at least 5vh on a TV, words 24 px
	 * and 3vh, and a unit at most half its number. The TV's numbers take 6vh
	 * so that their unit, at half, still clears the 2.9vh floor.
	 */
	import { untrack } from 'svelte';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ZoneDot from '$lib/components/ZoneDot.svelte';
	import ComputerHead from '$lib/session/ComputerHead.svelte';
	import { ZONE_BG } from '$lib/components/zones';
	import { pulse } from '$lib/motion/transitions';
	import { fieldDimmer } from '$lib/session/field-dim';
	import ClimbProfile from '$lib/ride/ClimbProfile.svelte';
	import {
		PAGE_NAMES,
		TV_LABEL,
		claimPageTurn,
		climbHeader,
		fieldsFor,
		pagesFor,
		type Field,
		turned,
		type ComputerContext,
		type ComputerPage,
	} from '$lib/session/computer-pages';

	let {
		tv = false,
		phone = false,
		climbOpens = false,
		docked = false,
		wide = false,
		ftp = 0,
		...ctx
	}: ComputerContext & {
		/** At three metres, sized in vh (TvMode). */
		tv?: boolean;
		/** A phone in the hand: a 3×2 grid. */
		phone?: boolean;
		/** A free or route ride, where CLIMB opens by itself (ADR-0071 as amended). */
		climbOpens?: boolean;
		/**
		 * Over the world, one panel at the left edge (#3668): the page control
		 * ← name → with dots (D15), the head — the 3 s power, W/kg, the zone,
		 * the target track — and the page's fields in a grid under a hairline.
		 * The dock is the panel, so this draws none of its own.
		 */
		docked?: boolean;
		/** Docked in a flat panel the column wide: the head and the fields side by side. */
		wide?: boolean;
		/** For the head's zone and target track; read only when docked. */
		ftp?: number;
	} = $props();

	let page = $state<ComputerPage>('ride');
	const pages = $derived(pagesFor(ctx));
	const shown = $derived(pages.includes(page) ? page : 'ride');
	const fields = $derived(fieldsFor(shown, { ...ctx, ownHead: docked }));
	// Docked under a target the head's track takes the profile's room; the
	// Skyline under the computer draws the climb and your dot.
	const profile = $derived(
		shown === 'climb' && !!ctx.climb && !(docked && ctx.target),
	);
	const turns = $derived(pages.length > 1);
	// Docked on the TV (#3677): the same panel in vh, so it reads at 3 m.
	const label = $derived(tv ? TV_LABEL : 'ride-label');
	// On the TV the fields are the panel's last row and take the height the
	// head leaves (ride-tv 9): up to three to a row, each number sized from
	// the row's box and its column's width (a figure is about 0.62 em, its
	// unit half that), between SPEC's 5vh floor and well under the watts.
	const tvRows = $derived(Math.max(1, Math.ceil(fields.length / 3)));
	const tvCols = $derived(Math.min(3, Math.max(1, fields.length)));
	const TV_COLS = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3'];
	const tvFields = $derived(
		`calc(2vh + ${tvRows} * (3vh + 0.25rem + 10vh) + ${tvRows - 1} * 1.5vh)`,
	);
	function tvValue(field: Field): string {
		const ems =
			field.value.length * 0.62 +
			(field.unit ? field.unit.length * 0.3 + 0.3 : 0);
		const tall = `calc((100cqh - ${tvRows} * (3vh + 0.25rem) - ${tvRows - 1} * 1.5vh) / ${tvRows})`;
		const wide = `calc((100cqw - ${tvCols - 1} * 2vw) / ${tvCols} / ${ems.toFixed(2)})`;
		return `clamp(5vh, min(${tall}, ${wide}), 20vh)`;
	}

	function turn(dir: 1 | -1) {
		page = turned(pages, shown, dir);
	}

	const size = $derived(
		tv
			? fields.length > 2
				? { value: 'text-[6vh]', unit: 'text-[3vh]', word: 'text-[3vh]' }
				: { value: 'text-[10vh]', unit: 'text-[5vh]', word: 'text-[3vh]' }
			: phone
				? { value: 'text-2xl', unit: 'text-xs', word: 'text-sm' }
				: { value: 'text-4xl', unit: 'text-lg', word: 'text-2xl' },
	);
	const layout = $derived(
		phone
			? 'grid grid-cols-3 gap-x-3 gap-y-2'
			: tv
				? 'flex flex-wrap items-start gap-x-[2.5vw] gap-y-[2vh]'
				: 'flex flex-wrap items-start gap-x-6 gap-y-3',
	);

	// The gear pulses once when it changes (ADR-0084), never on arrival.
	let gearField = $state<HTMLElement>();
	let gearSeen = untrack(() => ctx.gear);
	$effect(() => {
		const gear = ctx.gear;
		if (gear === gearSeen) return;
		gearSeen = gear;
		pulse(gearField);
	});

	// On a free or route ride CLIMB opens by itself from RIDE when a climb
	// begins (ADR-0071 as amended, #3645), once a climb: a rider on another
	// page chose it, and a chip says where the climb is instead; one who paged
	// away from CLIMB is not pulled back. A workout keeps RIDE, and its chip.
	let openedFor: number | null = null;
	$effect(() => {
		const climb = ctx.climb?.climb.startM ?? null;
		if (!climbOpens || climb === null || climb === openedFor) return;
		openedFor = climb;
		if (untrack(() => shown) === 'ride') page = 'climb';
	});

	// A plain field's number dims to 60 % after 20 s unchanged (#3215): ink at
	// /60 is the ramp's legible floor, so it is the colour, never an opacity
	// (no-faded-text). The 3 s power and the neon figures never dim.
	const dimmer = fieldDimmer();
	let now = $state(Date.now());
	$effect(() => {
		const stamp = Date.now();
		for (const f of fields)
			dimmer.see(f.key, `${f.value}${f.unit ?? ''}`, stamp);
		now = stamp;
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
	});

	const zoneStrip = $derived(
		shown === 'power' && ctx.stats ? ctx.stats.zoneSeconds.slice(1, 8) : null,
	);
</script>

<svelte:window
	onkeydown={(event) => {
		if (!turns) return;
		const dir = claimPageTurn(event);
		if (dir) turn(dir);
	}}
/>

<section
	data-testid="bike-computer"
	data-page={shown}
	aria-label="bike computer, {PAGE_NAMES[shown]} page"
	class={docked
		? tv
			? 'relative flex min-h-0 flex-1 flex-col gap-[1.5vh] px-[1.5vw] py-[1.5vh]'
			: wide
				? 'relative flex w-full flex-col gap-3 px-4 py-3'
				: 'relative flex w-[21rem] max-w-full flex-col gap-3 px-4 py-3'
		: 'panel relative'}
>
	<!-- The page's name and its dots sit in the row of numbers, so a page is
	     one row tall where it fits and the focus above keeps its height (#3597);
	     a phone's grid puts them above and below. -->
	{#snippet badge()}
		<!-- The climb's class in the Skyline's chip, beside every page's name
		     while a classed climb is near: on CLIMB it names the climb, on the
		     others it offers it (#3645), and it takes no row of its own. -->
		{#if ctx.climb}<span
				data-testid={shown === 'climb' ? 'climb-class' : 'climb-chip'}
				class="border-neon bg-surface text-ink rounded border px-1 leading-none font-bold tracking-normal"
				>{#if shown !== 'climb'}<span class="sr-only">{'climb '}</span>{/if}{ctx
					.climb.card.cls}</span
			>{/if}
	{/snippet}
	{#snippet name()}
		<!-- CLIMB's name counts the climbs. -->
		<p
			class="{size.word} text-muted flex items-center gap-3 leading-none whitespace-nowrap {phone
				? 'mb-2'
				: ''}"
		>
			<span class="tracking-[0.2em]"
				>{shown === 'climb' && ctx.climb
					? climbHeader(ctx.climb)
					: PAGE_NAMES[shown]}</span
			>{@render badge()}
		</p>
	{/snippet}
	{#snippet dots()}
		<div
			class="relative flex {phone
				? 'mt-1 -mb-2 justify-center'
				: 'ml-auto self-center'}"
		>
			{#each pages as p (p)}
				<button
					type="button"
					data-testid="computer-dot"
					onclick={() => (page = p)}
					aria-label="{PAGE_NAMES[p]} page"
					aria-current={p === shown ? 'page' : undefined}
					class="flex h-11 w-11 items-center justify-center"
				>
					<span
						class="size-2.5 rounded-full border forced-color-adjust-none {p ===
						shown
							? 'bg-neon border-neon forced-colors:bg-[Highlight]'
							: 'border-muted'}"
					></span>
				</button>
			{/each}
		</div>
	{/snippet}
	{#snippet strip(bars: number[])}
		<!-- Time in each zone as one strip of seven, each as wide as its time:
		     the ride summary's own picture, thin enough to leave the TV's
		     horizon its height. -->
		<div
			data-testid="zone-strip"
			aria-label="time in zones 1 to 7"
			role="img"
			class="flex overflow-hidden rounded-full {tv
				? 'mt-[1vh] h-[1.5vh]'
				: 'mt-3 h-2'}"
		>
			{#each bars as seconds, i (i)}
				<span class={ZONE_BG[i + 1]} style:flex-grow={seconds}></span>
			{/each}
		</div>
	{/snippet}

	{#if turns && !tv}
		<!-- The whole panel turns the page (ADR-0071). First, so the dots — the
		     only other positioned thing in it — paint above it. Not on the TV,
		     which has nothing to walk over and tap: its keys do. Docked, the
		     arrows are the named way and this is the pointer's. -->
		<button
			type="button"
			onclick={() => turn(1)}
			aria-label="next page, {PAGE_NAMES[turned(pages, shown, 1)]}"
			aria-hidden={docked || undefined}
			tabindex={docked ? -1 : undefined}
			class="focus-visible:outline-neon absolute inset-0 rounded-lg focus-visible:outline-2"
		></button>
	{/if}
	{#if docked}
		<!-- D15: the current page's name between ← and →, with position dots. -->
		<div data-testid="computer-page-row" class="relative flex items-center">
			{#if turns}
				<button
					type="button"
					onclick={() => turn(-1)}
					aria-label="previous page, {PAGE_NAMES[turned(pages, shown, -1)]}"
					title="Previous page"
					class="icon-btn-lg -ml-2 shrink-0"
					><ChevronLeft size={24} class={tv ? 'size-[3.4vh]' : ''} /></button
				>
			{/if}
			<p class="{label} text-ink flex items-center gap-2 whitespace-nowrap">
				{shown === 'climb' && ctx.climb
					? climbHeader(ctx.climb)
					: PAGE_NAMES[shown]}{@render badge()}
			</p>
			{#if turns}
				<button
					type="button"
					onclick={() => turn(1)}
					aria-label="next page, {PAGE_NAMES[turned(pages, shown, 1)]}"
					title="Next page"
					class="icon-btn-lg shrink-0"
					><ChevronRight size={24} class={tv ? 'size-[3.4vh]' : ''} /></button
				>
				<!-- In the world's column the dots take the right edge; in a wide
				     flat panel they stay beside the name (#3669). -->
				<div class="ml-auto flex gap-1 @2xl:ml-4" aria-hidden="true">
					{#each pages as p (p)}
						<span
							data-testid="computer-dot"
							class="{tv
								? 'size-[2.9vh]'
								: 'size-2.5'} rounded-full border forced-color-adjust-none {p ===
							shown
								? 'bg-neon border-neon forced-colors:bg-[Highlight]'
								: 'border-muted'}"
						></span>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
	{#if phone}{@render name()}{/if}
	<!-- On the TV the fields stand under the head (#3677): its watts take the
	     width, and the height the panel has after every word (ride-tv 9). -->
	<div
		class={docked && tv
			? 'flex min-h-0 flex-1 flex-col gap-[2vh]'
			: docked && wide
				? 'flex flex-wrap items-end gap-x-8 gap-y-3'
				: 'contents'}
	>
		{#if docked}
			<div class={tv ? 'flex min-h-0 min-w-0 flex-col' : 'contents'}>
				<ComputerHead
					power={ctx.stats?.seconds ? ctx.stats.power3 : Math.round(ctx.watts)}
					kg={ctx.kg}
					{ftp}
					stale={ctx.stale}
					target={ctx.target}
					blockExecution={ctx.stats?.blockExecution ?? null}
					{tv}
				/>
			</div>
		{/if}
		<div
			class={docked
				? tv
					? `border-neon/20 [container-type:size] grid min-h-0 shrink grow ${TV_COLS[tvCols]} gap-x-[2vw] gap-y-[1.5vh] border-t pt-[2vh]`
					: wide
						? 'border-neon/20 grid min-w-0 flex-1 auto-cols-fr grid-flow-col gap-x-8 border-l pl-8'
						: 'border-neon/20 grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-3'
				: layout}
			data-testid={docked ? 'computer-fields' : undefined}
			style:flex-basis={docked && tv ? tvFields : undefined}
		>
			{#if !phone && !docked}{@render name()}{/if}
			{#each fields as field (field.key)}
				<div
					data-testid="computer-field"
					data-field={field.key}
					class="min-w-0"
				>
					<span
						class="{docked
							? label
							: `${size.word} text-muted`} flex items-center gap-2 leading-none"
						>{field.label}{#if field.zone}<ZoneDot
								zone={field.zone}
								class={tv ? 'size-[1.4vh]' : 'size-2'}
							/>{/if}</span
					>
					{#if field.key === 'gear'}
						<span
							bind:this={gearField}
							aria-live="polite"
							class="num text-neon mt-1 block {size.value} leading-none font-bold"
							style:font-size={docked && tv ? tvValue(field) : undefined}
							>{field.value}</span
						>
					{:else}
						<!-- A space, not a margin, between number and unit: "78 rpm"
					     is what a screen reader and a search both read. Neon is a
					     model's number, flat: only live data glows (ADR-0005). The
					     unit's own line-height would make a page with units 2 px
					     taller than one without, so a turn would move the panel. -->
						<span
							class="num mt-1 block {size.value} leading-none font-bold {field.glow
								? 'text-watt glow-text'
								: field.neon
									? 'text-neon'
									: dimmer.dimmed(field.key, now)
										? 'text-ink/60'
										: 'text-ink'}"
							style:font-size={docked && tv ? tvValue(field) : undefined}
							>{field.value}{#if field.unit}{' '}<span
									class="text-muted {size.unit} leading-none font-normal"
									>{field.unit}</span
								>{/if}</span
						>
					{/if}
				</div>
			{/each}
			{#if turns && !tv && !phone && !docked && !profile}{@render dots()}{/if}
		</div>
	</div>
	{#if zoneStrip}{@render strip(zoneStrip)}{/if}
	{#if profile && ctx.climb}
		<!-- Flat, the dots ride beside the profile, so CLIMB is no taller than
		     RIDE and the Skyline under it keeps its place; a narrow panel wraps
		     them under it rather than squeeze the climb. -->
		<div class="flex flex-wrap items-end gap-3">
			<div class="min-w-60 flex-1"><ClimbProfile view={ctx.climb} {tv} /></div>
			{#if turns && !tv && !phone && !docked}{@render dots()}{/if}
		</div>
	{/if}
	{#if turns && phone}{@render dots()}{/if}
</section>
