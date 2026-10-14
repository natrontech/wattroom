<script lang="ts">
	// The Appearance section of the profile page (#331, ADR-0005 amended):
	// the palette, and the scheme toggle that lived on the room rail until
	// ADR-0020 retired it (#326). Split out of the page for size.
	import PalettePicker from '$lib/components/PalettePicker.svelte';
	import { prefersReducedMotion } from '$lib/motion';
	import { theme, type ThemeChoice } from '$lib/theme.svelte';
	import { STEADY_BUTTON } from '$lib/world/ride-view';
	import {
		setWorldMode,
		WORLD_MODES,
		worldMode,
		type WorldMode,
	} from '$lib/world/mode';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';

	const SCHEMES: { value: ThemeChoice; label: string; icon: typeof Monitor }[] =
		[
			{ value: 'auto', label: 'Auto', icon: Monitor },
			{ value: 'dark', label: 'Dark', icon: Moon },
			{ value: 'light', label: 'Light', icon: Sun },
		];

	// The World control (#3214, ADR-0079): how much the world moves on this
	// device. Never chosen, reduced motion opens on Flat.
	let mode = $state<WorldMode>(
		worldMode() ?? (prefersReducedMotion.current ? 'flat' : 'full'),
	);
	let chosen = $state(worldMode() !== null);
	function choose(next: WorldMode) {
		mode = next;
		chosen = true;
		setWorldMode(next);
	}

	// One label column, so every row's first control starts at the same x; on a
	// phone the label sits above its row, which a column would wrap. The hint
	// sits right of the controls on a desk and below them on a phone.
	const COLUMNS = 'sm:grid-cols-[4.5rem_1fr] gap-x-3';
	const ROW = `mt-5 grid items-baseline gap-y-2 ${COLUMNS}`;
	const HINT = 'text-muted basis-full text-xs lg:basis-auto';
</script>

<!-- Full theme (#331, ADR-0005 amended): every colour moves together. -->
<section class="panel panel-xl mt-8">
	<h2 class="font-display font-bold">Appearance</h2>
	<div class="mt-4 grid {COLUMNS}">
		<div class="sm:col-start-2">
			<PalettePicker />
		</div>
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
	<details class="group mt-5" open={!chosen && prefersReducedMotion.current}>
		<summary class="eyebrow flex min-h-7 cursor-pointer items-center gap-1">
			<ChevronRight size={12} class="group-open:rotate-90" />
			Advanced
		</summary>
		<div class={ROW}>
			<span class="eyebrow">world</span>
			<div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
				{#each WORLD_MODES as option (option.mode)}
					<button
						onclick={() => choose(option.mode)}
						aria-pressed={mode === option.mode}
						title={option.line}
						class="btn btn-xs {mode === option.mode
							? 'btn-primary'
							: 'btn-secondary'}"
					>
						{option.label}
					</button>
				{/each}
			</div>
			<p class="{HINT} sm:col-start-2">
				{#each WORLD_MODES as option (option.mode)}
					{#if option.mode === mode}{option.label} — {option.line}{/if}
				{/each}
			</p>
			{#if !chosen && prefersReducedMotion.current}
				<button
					onclick={() => choose('steady')}
					class="btn btn-secondary btn-lg justify-self-start sm:col-start-2"
				>
					{STEADY_BUTTON}
				</button>
			{/if}
		</div>
	</details>
</section>
