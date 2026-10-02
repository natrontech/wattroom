<script lang="ts">
	// The Appearance section of the profile page (#331, ADR-0005 amended):
	// the palette, and the scheme toggle that lived on the room rail until
	// ADR-0020 retired it (#326). Split out of the page for size.
	import PalettePicker from '$lib/components/PalettePicker.svelte';
	import { prefersReducedMotion } from '$lib/motion';
	import { theme, type ThemeChoice } from '$lib/theme.svelte';
	import { worldSlotOn } from '$lib/world/flag';
	import { flatRoad, setFlatRoad } from '$lib/world/world-view.svelte';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';

	const SCHEMES: { value: ThemeChoice; label: string; icon: typeof Monitor }[] =
		[
			{ value: 'auto', label: 'Auto', icon: Monitor },
			{ value: 'dark', label: 'Dark', icon: Moon },
			{ value: 'light', label: 'Light', icon: Sun },
		];

	// How a ride on a road is drawn on this device (#3080): the world, or the
	// Skyline. Never chosen, reduced motion starts on the flat road (ADR-0079).
	let flat = $state(flatRoad() ?? prefersReducedMotion.current);
	const ROADS = [
		{ flat: false, label: '3D world' },
		{ flat: true, label: 'Flat road' },
	];

	// One label column, so every row's first control starts at the same x; the
	// hint sits right of the controls on a desk and below them on a phone.
	const ROW = 'mt-5 grid grid-cols-[4.5rem_1fr] items-baseline gap-x-3';
	const HINT = 'text-muted basis-full text-xs lg:basis-auto';
</script>

<!-- Full theme (#331, ADR-0005 amended): every colour moves together. -->
<section class="panel panel-xl mt-8">
	<h2 class="font-display font-bold">Appearance</h2>
	<div class="mt-4">
		<PalettePicker />
	</div>
	<!-- The scheme toggle lived on the room rail until ADR-0020 retired it
	     (#326): auto follows the OS, the ride is always dark. -->
	<div class={ROW}>
		<span class="eyebrow">scheme</span>
		<div class="flex flex-wrap items-center gap-2">
			{#each SCHEMES as option (option.value)}
				<button
					onclick={() => theme.set(option.value)}
					aria-pressed={theme.current === option.value}
					class="btn btn-xs {theme.current === option.value
						? 'btn-primary'
						: 'btn-secondary'}"
				>
					<option.icon size={12} />
					{option.label}
				</button>
			{/each}
			<span class={HINT}>auto follows your OS — the ride is always dark</span>
		</div>
	</div>
	{#if worldSlotOn()}
		<div class={ROW}>
			<span class="eyebrow">road</span>
			<div class="flex flex-wrap items-center gap-2">
				{#each ROADS as option (option.label)}
					<button
						onclick={() => {
							flat = option.flat;
							setFlatRoad(option.flat);
						}}
						aria-pressed={flat === option.flat}
						class="btn btn-xs {flat === option.flat
							? 'btn-primary'
							: 'btn-secondary'}"
					>
						{option.label}
					</button>
				{/each}
				<span class={HINT}>how a ride on a road is drawn on this device</span>
			</div>
		</div>
	{/if}
</section>
