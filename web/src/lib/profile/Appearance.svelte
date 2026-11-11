<script lang="ts">
	// The Appearance section of the profile page (#331, ADR-0005 amended):
	// the palette, and the scheme toggle that lived on the room rail until
	// ADR-0020 retired it (#326). Split out of the page for size.
	import PalettePicker from '#lib/components/PalettePicker.svelte';
	import { prefersReducedMotion } from '#lib/motion/index.ts';
	import { theme, type ThemeChoice } from '#lib/theme.svelte.ts';
	import { STEADY_BUTTON } from '#lib/world/ride-view.ts';
	import {
		setWorldDiorama,
		setWorldMode,
		WORLD_MODES,
		worldDiorama,
		worldMode,
		type WorldMode,
	} from '#lib/world/mode.ts';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';

	const SCHEMES: { value: ThemeChoice; label: string; icon: typeof Monitor }[] =
		[
			{ value: 'auto', label: 'Auto', icon: Monitor },
			{ value: 'dark', label: 'Dark', icon: Moon },
			{ value: 'light', label: 'Light', icon: Sun },
		];

	// The World control (#3214, ADR-0079): 3D or Flat on this device, and how
	// much the world moves. Never chosen is the world.
	let mode = $state<WorldMode>(worldMode() ?? 'full');
	let chosen = $state(worldMode() !== null);
	function choose(next: WorldMode) {
		mode = next;
		chosen = true;
		setWorldMode(next);
	}

	// Diorama 3D (diorama.ts): the world as a model railway with the lounge's people, until the rider picks Smooth.
	let diorama = $state(worldDiorama());
	function look(on: boolean) {
		diorama = on;
		setWorldDiorama(on);
	}
	const LOOKS = [
		{ on: true, label: 'Diorama' },
		{ on: false, label: 'Smooth' },
	];

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
	     (#326): auto follows the OS, a ride included; TV mode and the HUD
	     stay dark (#4160). -->
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
			<span class={HINT}
				>auto follows your OS — TV mode and the HUD stay dark</span
			>
		</div>
	</div>
	<div class={ROW}>
		<span class="eyebrow">3D world</span>
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
			<p class="{HINT} col-span-2 sm:col-span-1">
				{#each WORLD_MODES as option (option.mode)}
					{#if option.mode === mode}{option.label} — {option.line}{/if}
				{/each}
			</p>
		</div>
		{#if !chosen && prefersReducedMotion.current}
			<button
				onclick={() => choose('steady')}
				class="btn btn-secondary btn-lg justify-self-start sm:col-start-2"
			>
				{STEADY_BUTTON}
			</button>
		{/if}
	</div>
	<!-- Only where 3D draws: Flat has no look to choose. -->
	{#if mode !== 'flat'}
		<div class={ROW}>
			<span class="eyebrow">3D look</span>
			<div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
				{#each LOOKS as option (option.label)}
					<button
						onclick={() => look(option.on)}
						aria-pressed={diorama === option.on}
						class="btn btn-xs {diorama === option.on
							? 'btn-primary'
							: 'btn-secondary'}"
					>
						{option.label}
					</button>
				{/each}
				<span class="{HINT} col-span-2 sm:col-span-1"
					>{diorama
						? 'a model railway, with the lounge’s people'
						: 'plain 3D, for a slower machine'} — from the next ride</span
				>
			</div>
		</div>
	{/if}
</section>
