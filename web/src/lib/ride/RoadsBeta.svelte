<script lang="ts">
	/**
	 * Roads ride on SPEC's proposed numbers before the Kickr sitting tunes
	 * them (ADR-0062's 2026-10-16 amendment): every place a rider chooses a
	 * road says so, here, until #3351 settles the numbers and this goes.
	 */
	let { class: extra = '' }: { class?: string } = $props();
</script>

<p
	class="text-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-xs {extra}"
	data-testid="roads-beta"
>
	<span
		class="border-neon/60 text-ink rounded border px-2 font-semibold tracking-[0.2em] uppercase"
		>Beta</span
	>
	<span>A road’s feel is still being tuned on real trainers.</span>
</p>
