<script lang="ts">
	let { cheers }: { cheers: { id: number; emoji: string; from: string }[] } =
		$props();
</script>

<!--
	Cheers pop on the rider's dashboard and leave (WATTROOM.md feel layer). Non-blocking
	and out of the metrics' way — you are on a bike, so this can never need dismissing.
-->
<div
	class="pointer-events-none absolute right-6 bottom-6 z-20 flex flex-col items-end gap-2"
>
	{#each cheers as cheer (cheer.id)}
		<div class="cheer flex items-center gap-2">
			<span
				class="text-muted bg-surface/80 rounded-full px-2 py-0.5 text-[11px]"
				>{cheer.from}</span
			>
			<span class="text-3xl">{cheer.emoji}</span>
		</div>
	{/each}
</div>

<style>
	.cheer {
		animation: rise 2.6s ease-out forwards;
	}
	@keyframes rise {
		0% {
			opacity: 0;
			transform: translateY(12px) scale(0.8);
		}
		15% {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
		75% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translateY(-28px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.cheer {
			animation: none;
		}
	}
</style>
