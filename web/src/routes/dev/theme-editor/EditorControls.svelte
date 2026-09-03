<!--
	One family's sliders (#402). Three hues plus an optional watt lightness/
	chroma escape hatch is the entire input space deriveTheme() takes — this is
	that space as controls, nothing more.
-->
<script lang="ts" module>
	export interface EditorState {
		name: string;
		wattHue: number;
		neonHue: number;
		surfaceHue: number;
		useWattLc: boolean;
		wattL: number;
		wattC: number;
	}
</script>

<script lang="ts">
	let { state = $bindable() }: { state: EditorState } = $props();

	const hues: { key: 'wattHue' | 'neonHue' | 'surfaceHue'; label: string }[] = [
		{ key: 'wattHue', label: 'watt · live data' },
		{ key: 'neonHue', label: 'neon · chrome' },
		{ key: 'surfaceHue', label: 'surface' },
	];
</script>

<div class="space-y-3">
	<label class="block">
		<span class="eyebrow">name</span>
		<input class="input mt-1 w-full" bind:value={state.name} />
	</label>

	{#each hues as hue (hue.key)}
		<label class="block">
			<span class="eyebrow">{hue.label} · {Math.round(state[hue.key])}°</span>
			<input
				type="range"
				min="0"
				max="359"
				class="mt-1 w-full"
				bind:value={state[hue.key]}
			/>
		</label>
	{/each}

	<label class="flex items-center gap-2 text-xs">
		<input type="checkbox" bind:checked={state.useWattLc} />
		<span class="text-muted">
			override watt lightness/chroma — needed when a hue can't hold the family's
			default at that lightness (yellow, green)
		</span>
	</label>

	{#if state.useWattLc}
		<label class="block">
			<span class="eyebrow">watt lightness · {state.wattL.toFixed(2)}</span>
			<input
				type="range"
				min="0"
				max="1"
				step="0.01"
				class="mt-1 w-full"
				bind:value={state.wattL}
			/>
		</label>
		<label class="block">
			<span class="eyebrow">watt chroma · {state.wattC.toFixed(3)}</span>
			<input
				type="range"
				min="0"
				max="0.4"
				step="0.005"
				class="mt-1 w-full"
				bind:value={state.wattC}
			/>
		</label>
	{/if}
</div>
