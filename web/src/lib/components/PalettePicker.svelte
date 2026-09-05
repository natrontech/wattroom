<!--
	Full theme picker (#331). Presets apply on click — no save step, the way
	the scheme toggle already behaves — and "Reset to Outrun" is the undo, per
	errors.md. Each swatch paints itself in the theme it offers, so the choice
	is made by looking rather than by reading colour names.
-->
<script lang="ts">
	import { tokenDeclarations } from '$lib/palette';
	import { DEFAULT_CHOICE, DEFAULT_IDENTITY, themesFor } from '$lib/themes';
	import { palette } from '$lib/palette.svelte';

	const choice = $derived(palette.choice);
	const selectedId = $derived(choice.identity);
	const presets = $derived(themesFor(palette.family));
</script>

{#snippet chip()}
	<span
		class="border-ink/10 bg-surface relative h-11 w-16 shrink-0 overflow-hidden rounded border"
	>
		<span class="bg-surface-raised absolute inset-x-1 top-1 h-5 rounded"></span>
		<span class="bg-neon absolute inset-x-2 top-2 h-1 rounded-full opacity-80"
		></span>
		<!-- The data bar glows and the chrome bar does not: the swatch states the
		     rule rather than relying on the caption to explain it. glow-stroke is
		     driven by currentColor, and is transparent on light by design. -->
		<span
			class="glow-stroke bg-watt text-watt absolute inset-x-2 bottom-2 h-1.5 rounded-full"
		></span>
	</span>
{/snippet}

<div>
	<span class="eyebrow">theme · {palette.family}</span>
	<p class="text-muted mt-1 text-xs">
		Every surface, label, data colour, and power zone moves together. Watt marks
		live data and is the only colour that glows; neon stays structural chrome.
	</p>

	<div class="mt-3 grid gap-2 sm:grid-cols-2">
		{#each presets as preset (preset.id)}
			<button
				type="button"
				class="flex items-center gap-3 rounded-lg border p-3 text-left {selectedId ===
				preset.identity
					? 'border-ink/60'
					: 'border-muted/20 hover:border-muted/50'}"
				style={tokenDeclarations(preset)}
				onclick={() =>
					palette.select({ kind: 'preset', identity: preset.identity })}
			>
				{@render chip()}
				<span class="min-w-0">
					<span class="block text-sm font-medium">{preset.name}</span>
					<span class="text-muted block text-[11px]">{preset.note}</span>
				</span>
			</button>
		{/each}
	</div>

	{#if selectedId !== DEFAULT_IDENTITY}
		<button
			type="button"
			class="btn btn-ghost btn-xs mt-2 px-0"
			onclick={() => palette.select(DEFAULT_CHOICE)}
		>
			Reset to Outrun
		</button>
	{/if}
</div>
