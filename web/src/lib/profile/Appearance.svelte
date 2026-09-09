<script lang="ts">
	// The Appearance section of the profile page (#331, ADR-0005 amended):
	// the palette, and the scheme toggle that lived on the room rail until
	// ADR-0020 retired it (#326). Split out of the page for size.
	import PalettePicker from '$lib/components/PalettePicker.svelte';
	import { theme, type ThemeChoice } from '$lib/theme.svelte';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';

	const SCHEMES: { value: ThemeChoice; label: string; icon: typeof Monitor }[] =
		[
			{ value: 'auto', label: 'Auto', icon: Monitor },
			{ value: 'dark', label: 'Dark', icon: Moon },
			{ value: 'light', label: 'Light', icon: Sun },
		];
</script>

<!-- Full theme (#331, ADR-0005 amended): every colour moves together. -->
<section class="border-muted/15 mt-3 rounded-lg border p-6">
	<h2 class="font-display font-bold">Appearance</h2>
	<div class="mt-4">
		<PalettePicker />
	</div>
	<!-- The scheme toggle lived on the room rail until ADR-0020 retired it
	     (#326): auto follows the OS, the ride is always dark. -->
	<div class="mt-5 flex flex-wrap items-center gap-2">
		<span class="eyebrow mr-1">scheme</span>
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
		<span class="text-muted text-[11px]">
			auto follows your OS — the ride is always dark
		</span>
	</div>
</section>
