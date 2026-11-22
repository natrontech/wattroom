<script lang="ts">
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import { heard } from '#lib/sound/heard.svelte.ts';
	import RecentSounds from '#lib/sound/RecentSounds.svelte';

	/**
	 * The caption under every cue (ux.md: a state change gets a sound and a
	 * visual): the newest sound's meaning, up long enough to glance at from the
	 * bike, and a tap away from the last few. A chime with nothing on screen —
	 * a rider stepping out, a voice dropping, the world going flat — used to
	 * leave the room guessing what it was.
	 */
	const SHOWN_MS = 10_000;

	let shownSeq = $state(0);
	let open = $state(false);
	const latest = $derived(heard.list[0]);
	$effect(() => {
		const seq = latest?.seq;
		if (!seq) return;
		shownSeq = seq;
		const id = setTimeout(() => {
			if (shownSeq === seq) shownSeq = 0;
		}, SHOWN_MS);
		return () => clearTimeout(id);
	});
	const visible = $derived(open || (!!latest && shownSeq === latest.seq));
</script>

{#if visible && latest}
	<div class="pointer-events-auto flex w-full flex-col items-center gap-2">
		<button
			type="button"
			class="panel flex min-h-11 max-w-full items-center gap-2 rounded-full px-4 py-2 text-sm"
			aria-expanded={open}
			data-testid="sound-caption"
			onclick={() => (open = !open)}
		>
			<Volume2 size={15} class="text-muted shrink-0" />
			<span class="truncate">{latest.text}</span>
		</button>
		{#if open}
			<div class="panel w-full px-4 py-3">
				<div class="mb-2 flex items-center justify-between">
					<h3 class="eyebrow">recent sounds</h3>
					<button
						type="button"
						class="btn btn-secondary btn-xs"
						onclick={() => (open = false)}>Close</button
					>
				</div>
				<RecentSounds />
			</div>
		{/if}
	</div>
{/if}
