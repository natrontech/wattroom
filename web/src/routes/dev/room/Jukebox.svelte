<script lang="ts">
	import { queue } from './mockRoom.svelte';
</script>

<!--
	YouTube RMF: the player is a dedicated tile ≥200×200, always visible while media
	plays, and nothing may be drawn on top of it. Making it a grid citizen rather than
	an overlay satisfies that by construction (WATTROOM.md).
-->
<aside class="flex flex-col gap-3">
	<div
		class="relative aspect-video min-h-[200px] min-w-[200px] overflow-hidden rounded-lg bg-black ring-1 ring-white/10"
	>
		<div
			class="text-muted absolute inset-0 grid place-items-center text-center text-xs"
			style="background: linear-gradient(150deg, #1a0736, #05010f)"
		>
			YouTube player tile<br />≥200×200, never overlaid
		</div>
	</div>

	<div>
		<div
			class="text-muted flex items-center justify-between text-[10px] tracking-wider uppercase"
		>
			<span>queue</span>
			<span>{queue.length} tracks</span>
		</div>
		<ul class="mt-2 space-y-1.5">
			{#each queue as track, i (track.title)}
				<li class="flex items-baseline gap-2 text-xs">
					<span
						class="{i === 0
							? 'text-watt'
							: 'text-muted'} w-3 shrink-0 font-mono text-[10px]"
						>{i === 0 ? '▶' : i + 1}</span
					>
					<span class="{i === 0 ? 'text-white' : 'text-muted'} truncate"
						>{track.title}</span
					>
					<span class="text-muted/60 ml-auto shrink-0 font-mono text-[10px]"
						>{track.length}</span
					>
				</li>
			{/each}
		</ul>
	</div>
</aside>
