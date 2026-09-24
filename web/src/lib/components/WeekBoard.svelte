<script lang="ts">
	import { people } from '$lib/people.svelte';
	import StatusMark from '$lib/status-line/StatusMark.svelte';
	// The weekly board (ADR-0036): this week only, and only because someone
	// turned it on. Shared by the crew's Members page and a voice channel's
	// Lounge.
	import { account } from '$lib/account.svelte';
	import type { BoardRow } from '$lib/crew-types';

	let { rows }: { rows: BoardRow[] } = $props();
</script>

<!-- The board (ADR-0036): below the tiles, this week only, and only
		     because someone turned it on. Category sits beside each name
		     because it says who is comparable — the useful half of a rank
		     without the ordering doing the talking. -->
<div class="panel mt-3">
	<div class="flex items-baseline justify-between gap-3">
		<p class="eyebrow">this week</p>
		<p class="text-muted text-[11px]">resets Monday</p>
	</div>
	<ol class="mt-2.5 space-y-1">
		{#each rows as row, i (row.id)}
			{@const you = row.id === account.me?.id}
			<li
				class="flex items-baseline gap-3 rounded px-2 py-1.5 text-sm {you
					? 'bg-surface-raised'
					: ''}"
			>
				<span class="text-muted w-4 shrink-0 font-mono text-xs tabular-nums"
					>{i + 1}</span
				>
				<span class="flex min-w-0 flex-1 items-baseline gap-1.5">
					<span class="truncate">{row.displayName}</span>
					<StatusMark line={people.face(row.id)?.statusLine} size={12} />
				</span>
				{#if row.category}
					<span
						class="border-muted/30 text-muted shrink-0 rounded border px-1.5 text-[10px]"
						title="category — who you are comparable with">{row.category}</span
					>
				{/if}
				<span class="shrink-0 font-mono text-xs tabular-nums"
					>{row.kj.toLocaleString()}<span class="text-muted ml-0.5">kJ</span
					></span
				>
			</li>
		{/each}
	</ol>
</div>
