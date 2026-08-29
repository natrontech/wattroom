<script lang="ts">
	import type { Snippet } from 'svelte';

	// In media-focus the player lives in the main area, so the panel must not render a second one.
	let {
		live,
		showPlayer,
		player,
		queue = [],
		onAdd,
		onCheer,
	}: {
		live: boolean;
		showPlayer: boolean;
		/** The real player (the jukebox) renders into the panel's top slot. */
		player?: Snippet;
		queue?: { title: string; by?: string }[];
		onAdd?: (url: string) => void;
		onCheer?: (emoji: string) => void;
	} = $props();

	// Any member can add (SPEC roles): paste is the golden path.
	let adding = $state(false);
	let url = $state('');

	// Chat is a fast-follow, not MVP — the panel says so itself.
	const messages: { who: string; text: string }[] = [];
</script>

<aside class="flex w-80 shrink-0 flex-col border-l border-white/5">
	{#if showPlayer && player}
		<div class="border-b border-white/5 p-3">
			{@render player()}
		</div>
	{/if}

	<div class="border-b border-white/5 px-4 py-3">
		<div
			class="text-muted flex items-center justify-between text-[10px] tracking-[0.2em] uppercase"
		>
			<span>queue</span>
			<button
				onclick={() => (adding = !adding)}
				class="text-muted hover:text-white"
				aria-label="Add to queue">{adding ? 'close' : '+ add'}</button
			>
		</div>

		{#if adding}
			<form
				class="mt-2"
				onsubmit={(e) => {
					e.preventDefault();
					if (url.trim()) onAdd?.(url.trim());
					url = '';
					adding = false;
				}}
			>
				<input
					bind:value={url}
					class="border-muted/25 placeholder:text-muted/60 w-full rounded border bg-transparent px-3 py-2 text-xs outline-none"
					placeholder="Paste a YouTube link"
				/>
			</form>
		{/if}
		<ul class="mt-2 space-y-1">
			{#each queue.slice(0, 5) as track, i (track.title + i)}
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
					{#if track.by}
						<span class="text-muted/60 ml-auto shrink-0 font-mono text-[10px]"
							>{track.by}</span
						>
					{/if}
				</li>
			{/each}
		</ul>
	</div>

	<div class="text-muted px-4 pt-3 pb-1 text-[10px] tracking-[0.2em] uppercase">
		chat <span class="text-muted/50 normal-case">· fast-follow, not MVP</span>
	</div>
	<ul
		class="flex flex-1 flex-col justify-end space-y-2 overflow-y-auto px-4 py-2"
	>
		{#each messages as message, i (i)}
			<li class="text-xs leading-snug">
				<span class="text-muted font-medium">{message.who}</span>
				<span class="ml-1.5 text-white/85">{message.text}</span>
			</li>
		{:else}
			<li class="text-muted/60 text-xs">Voice is the room's chat for now.</li>
		{/each}
	</ul>

	<div class="border-t border-white/5 p-3">
		{#if live}
			<!-- Mid-ride: typing is off the table, so the affordance is reactions, not a text field. -->
			<div class="flex gap-1.5">
				{#each ['🔥', '💀', '💪', '👏'] as emoji (emoji)}
					<button
						onclick={() => onCheer?.(emoji)}
						class="border-muted/20 hover:border-muted/50 flex-1 rounded border py-2 text-base"
						>{emoji}</button
					>
				{/each}
			</div>
		{:else}
			<div class="flex gap-1.5">
				{#each ['🔥', '💪', '👏', '🚀'] as emoji (emoji)}
					<button
						onclick={() => onCheer?.(emoji)}
						class="border-muted/20 hover:border-muted/50 flex-1 rounded border py-2 text-base"
						>{emoji}</button
					>
				{/each}
			</div>
		{/if}
	</div>
</aside>
