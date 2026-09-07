<script lang="ts">
	// What a session left behind (ADR-0034): who was here, when they came, and
	// how long they stayed. The only durable thing in the room's timeline, and
	// so the only entry with a border — everything around it stays as quiet as
	// it is now.
	//
	// Chrome, not live data (ADR-0005): --color-neon draws the edge and the
	// header and nothing here glows. The --color-watt pips mark riders who
	// rode, at rest.
	//
	// A <details> rather than a toggle: collapsed by default is what the
	// element already does, and it opens without a line of JavaScript.
	import { formatTime } from '$lib/format';
	import type { SessionRecap } from '$lib/protocol';
	import { recapBars, recapSummary } from '$lib/room/recap';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Clock from '@lucide/svelte/icons/clock';

	let { recap }: { recap: SessionRecap } = $props();

	const bars = $derived(recapBars(recap));
</script>

<details
	class="border-neon/25 bg-surface-raised/40 group ml-9 rounded-lg border"
>
	<summary
		class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs"
	>
		<Clock size={13} class="text-neon shrink-0" />
		<span class="min-w-0 truncate font-medium"
			>{recap.workout || 'Session'} ended</span
		>
		<span class="text-muted ml-auto shrink-0 tabular-nums"
			>{recapSummary(recap)}</span
		>
		<ChevronDown
			size={13}
			class="text-muted shrink-0 transition-transform group-open:rotate-180"
		/>
	</summary>

	<div class="border-neon/15 border-t px-3 py-3">
		<p class="text-muted mb-2 text-[11px] tabular-nums">
			{formatTime(recap.startedAt)} – {formatTime(recap.endedAt)}
		</p>
		<ul class="grid gap-1.5">
			{#each bars as bar (bar.id)}
				<li class="flex items-center gap-2 text-[11px]">
					<span
						class="size-1.5 shrink-0 rounded-full {bar.rode
							? 'bg-watt'
							: 'border-muted/60 border'}"
						aria-hidden="true"
					></span>
					<span class="w-16 shrink-0 truncate">{bar.rider}</span>
					<!-- The bar is the sentence: where it starts says when they
					     arrived, without anyone reading a number. -->
					<span class="bg-muted/10 relative h-2 min-w-0 flex-1 rounded-full">
						<span
							class="absolute inset-y-0 rounded-full {bar.rode
								? 'bg-watt/60'
								: 'bg-muted/40'}"
							style="left: {bar.left}%; width: {bar.width}%"
						></span>
					</span>
					<span class="text-muted w-14 shrink-0 text-right tabular-nums"
						>{bar.stayed}</span
					>
				</li>
			{/each}
		</ul>
		<p class="text-muted/70 mt-2 flex items-center gap-3 text-[10px]">
			<span class="flex items-center gap-1">
				<span class="bg-watt size-1.5 rounded-full" aria-hidden="true"></span>
				rode
			</span>
			<span class="flex items-center gap-1">
				<span
					class="border-muted/60 size-1.5 rounded-full border"
					aria-hidden="true"
				></span>
				here, did not ride
			</span>
		</p>
	</div>
</details>
