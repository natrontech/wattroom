<script lang="ts">
	import { play } from '$lib/sound/cues';
	import type { Cheer } from '$lib/protocol';
	import CheerIcon from '$lib/components/CheerIcon.svelte';

	// The reaction layer (#74): cheers arrive on the tick, float up, announce
	// with sound — riders don't watch the screen (.claude/rules/ux.md).
	let { cheers }: { cheers: Cheer[] | undefined } = $props();

	interface Floating extends Cheer {
		key: number;
		left: number;
	}
	let floating = $state<Floating[]>([]);
	let counter = 0;
	let seenTick: Cheer[] | undefined;

	$effect(() => {
		const batch = cheers;
		if (!batch || batch.length === 0 || batch === seenTick) return;
		seenTick = batch;
		// A burst lands higher than a single cheer — the pitch is the crowd size.
		play('cheer', Math.min((batch.length - 1) * 2, 12));
		const next = batch.map((cheer) => ({
			...cheer,
			key: counter++,
			left: 10 + Math.random() * 80,
		}));
		floating = [...floating, ...next].slice(-24);
		setTimeout(() => {
			const keys = new Set(next.map((f) => f.key));
			floating = floating.filter((f) => !keys.has(f.key));
		}, 2500);
	});
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-16 z-40">
	{#each floating as item (item.key)}
		<div class="cheer absolute bottom-0 text-center" style="left: {item.left}%">
			<!-- Ink, not the live hue: a cheer is a person, not a number (ADR-0005). -->
			<CheerIcon cheer={item.emoji} size={36} class="text-ink mx-auto" />
			<span class="text-muted block text-[10px]">{item.from}</span>
		</div>
	{/each}
</div>

<style>
	.cheer {
		animation: rise 2.4s ease-out forwards;
	}
	@keyframes rise {
		from {
			transform: translateY(0);
			opacity: 1;
		}
		to {
			transform: translateY(-40vh);
			opacity: 0;
		}
	}
</style>
