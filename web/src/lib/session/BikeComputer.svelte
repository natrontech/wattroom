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
	import ZoneDot from '$lib/components/ZoneDot.svelte';
	import { ZONE_BG } from '$lib/components/zones';
	import { pulse } from '$lib/motion/transitions';
	import {
		PAGE_NAMES,
		claimPageTurn,
		fieldsFor,
		pagesFor,
		turned,
		type ComputerContext,
		type ComputerPage,
	} from '$lib/session/computer-pages';

	let {
		tv = false,
		phone = false,
		...ctx
	}: ComputerContext & {
		/** At three metres, sized in vh (TvMode). */
		tv?: boolean;
		/** A phone in the hand: a 3×2 grid. */
		phone?: boolean;
	} = $props();

	let page = $state<ComputerPage>('ride');
	const pages = $derived(pagesFor(ctx.stats));
	const shown = $derived(pages.includes(page) ? page : 'ride');
	const fields = $derived(fieldsFor(shown, ctx));
	const turns = $derived(pages.length > 1);

	function turn(dir: 1 | -1) {
		page = turned(pages, shown, dir);
	}

	const size = $derived(
		tv
			? { value: 'text-[6vh]', unit: 'text-[3vh]', word: 'text-[3vh]' }
			: phone
				? { value: 'text-2xl', unit: 'text-xs', word: 'text-sm' }
				: { value: 'text-4xl', unit: 'text-lg', word: 'text-2xl' },
	);
	const layout = $derived(
		phone
			? 'grid grid-cols-3 gap-x-3 gap-y-2'
			: tv
				? 'flex flex-wrap items-end gap-x-[2.5vw] gap-y-[2vh]'
				: 'flex flex-wrap gap-x-8 gap-y-3',
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
	class="panel relative"
>
	<!-- On the TV the page's name sits in the row of numbers, so the panel is
	     one row tall and the horizon under it keeps its height. -->
	{#snippet name()}
		<p
			class="{size.word} text-muted leading-none tracking-[0.2em] {tv
				? 'self-start'
				: 'mb-2'}"
		>
			{PAGE_NAMES[shown]}
		</p>
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

	{#if !tv}{@render name()}{/if}
	<div class={layout}>
		{#if tv}{@render name()}{/if}
		{#each fields as field (field.key)}
			<div data-testid="computer-field" data-field={field.key} class="min-w-0">
				<span
					class="{size.word} text-muted flex items-center gap-2 leading-none"
					>{field.label}{#if field.zone}<ZoneDot
							zone={field.zone}
							class={tv ? 'size-[1.4vh]' : 'size-2'}
						/>{/if}</span
				>
				{#if field.neon}
					<span
						bind:this={gearField}
						aria-live="polite"
						class="num text-neon mt-1 block {size.value} leading-none font-bold"
						>{field.value}</span
					>
				{:else}
					<span
						class="num mt-1 block {size.value} leading-none font-bold {field.glow
							? 'text-watt glow-text'
							: 'text-ink'}"
						>{field.value}{#if field.unit}<span
								class="text-muted {size.unit} ml-1 font-normal"
								>{field.unit}</span
							>{/if}</span
					>
				{/if}
			</div>
		{/each}
	</div>
	{#if zoneStrip}{@render strip(zoneStrip)}{/if}

	{#if turns && !tv}
		<!-- The whole panel turns the page (ADR-0071); the dots sit above it.
		     Not on the TV, which has nothing to walk over and tap: its keys do. -->
		<button
			type="button"
			onclick={() => turn(1)}
			aria-label="next page, {PAGE_NAMES[turned(pages, shown, 1)]}"
			class="focus-visible:outline-neon absolute inset-0 rounded-lg focus-visible:outline-2"
		></button>
		<div class="relative mt-1 -mb-2 flex justify-center">
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
	{/if}
</section>
