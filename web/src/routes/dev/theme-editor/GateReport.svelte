<!--
	The same gate palette.test.ts runs in CI, live against a draft (#402/#612).
	Reverting Monokai's surfaces to the values it was built from is what asked
	for this: without it, "does this pass" only had one answer — run the test
	suite and read a stack trace.
-->
<script lang="ts">
	import { gateChecks } from '$lib/gate';
	import { THEMES } from '$lib/themes';
	import type { Theme } from '$lib/palette';

	let { theme }: { theme: Theme } = $props();

	const checks = $derived(gateChecks(theme, THEMES));
	const failing = $derived(checks.filter((c) => !c.passes));

	function fmt(n: number): string {
		return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '');
	}
</script>

<div>
	<span class="eyebrow">
		the gate · {checks.length - failing.length}/{checks.length} pass
	</span>
	<p class="text-muted/70 mt-1 text-[11px] leading-snug">
		Every check `make test` runs against this theme — contrast, the dark/white
		ceiling, accent separability, and adjacent-zone distance under both
		simulated colour-vision deficiencies. Zones aren't editable here, but a
		surface or accent choice can still break their fit against it.
	</p>

	{#if failing.length}
		<ul class="mt-2 space-y-1">
			{#each failing as c (c.id)}
				<li class="flex items-baseline gap-2 text-xs">
					<span class="min-w-0 flex-1 truncate">{c.label}</span>
					<span class="font-mono tabular-nums">
						{fmt(c.value)}{c.unit} / {fmt(c.floor)}{c.unit}
					</span>
					<span class="text-danger shrink-0 font-mono text-[10px]">fail</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-z4 mt-2 text-xs">Every check passes.</p>
	{/if}

	<details class="mt-2">
		<summary class="text-muted hover:text-ink cursor-pointer text-[11px]">
			show all {checks.length} checks
		</summary>
		<ul class="mt-1.5 space-y-1">
			{#each checks as c (c.id)}
				<li class="flex items-baseline gap-2 text-xs">
					<span class="text-muted min-w-0 flex-1 truncate">{c.label}</span>
					<span class="text-muted font-mono tabular-nums">
						{fmt(c.value)}{c.unit} / {fmt(c.floor)}{c.unit}
					</span>
					<span
						class="shrink-0 font-mono text-[10px] {c.passes
							? 'text-z4'
							: 'text-danger'}">{c.passes ? 'pass' : 'fail'}</span
					>
				</li>
			{/each}
		</ul>
	</details>
</div>
