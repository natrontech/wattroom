<script lang="ts">
	import { heard } from '#lib/sound/heard.svelte.ts';
	import { ago } from '#lib/sound/heard-ago.ts';

	// The list of what the last cues meant (heard.svelte.ts): where a rider
	// who heard a chime looks it up after its caption has gone.
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});
</script>

{#if heard.list.length === 0}
	<p class="text-muted text-sm">No sounds yet.</p>
{:else}
	<ol class="flex flex-col gap-1.5" data-testid="recent-sounds">
		{#each heard.list as cue (cue.seq)}
			<li class="flex items-baseline justify-between gap-3 text-sm">
				<span class="min-w-0">{cue.text}</span>
				<span class="text-muted font-display shrink-0 text-xs tabular-nums"
					>{ago(now - cue.at)}</span
				>
			</li>
		{/each}
	</ol>
{/if}
