<script lang="ts">
	import PlayerTile from './PlayerTile.svelte';
	import { chatLater, chatSeed, queue } from './mockRoom.svelte';

	// In media-focus the player lives in the main area, so the panel must not render a second one.
	let { live, showPlayer }: { live: boolean; showPlayer: boolean } = $props();

	// The queue existed with no way to put anything in it. Any member can add (SPEC roles).
	let adding = $state(false);
	const results = [
		{ title: 'Gunship — Tech Noir', length: '5:26' },
		{ title: 'FM-84 — Running in the Night', length: '4:53' },
		{ title: 'Dance With the Dead — Riot', length: '3:58' },
	];

	// The room keeps talking while you ride; enough to judge whether chat survives mid-effort.
	let messages = $state([...chatSeed]);
	$effect(() => {
		let i = 0;
		const timer = setInterval(() => {
			messages = [...messages, chatLater[i % chatLater.length]].slice(-14);
			i++;
		}, 5000);
		return () => clearInterval(timer);
	});
</script>

<aside class="flex w-80 shrink-0 flex-col border-l border-white/5">
	{#if showPlayer}
		<div class="border-b border-white/5 p-3">
			<PlayerTile />
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
			<div class="mt-2">
				<input
					class="border-muted/25 placeholder:text-muted/60 w-full rounded border bg-transparent px-3 py-2 text-xs"
					placeholder="Paste a YouTube link or search"
				/>
				<ul class="mt-1.5 space-y-0.5">
					{#each results as track (track.title)}
						<li>
							<button
								class="hover:bg-surface-raised flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left text-xs"
							>
								<span class="truncate">{track.title}</span>
								<span class="text-muted ml-auto shrink-0 font-mono text-[10px]"
									>{track.length}</span
								>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<ul class="mt-2 space-y-1">
			{#each queue.slice(0, 3) as track, i (track.title)}
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
		{/each}
	</ul>

	<div class="border-t border-white/5 p-3">
		{#if live}
			<!-- Mid-ride: typing is off the table, so the affordance is reactions, not a text field. -->
			<div class="flex gap-1.5">
				{#each ['🔥', '💀', '🤮', '👏'] as emoji (emoji)}
					<button
						class="border-muted/20 hover:border-muted/50 flex-1 rounded border py-2 text-base"
						>{emoji}</button
					>
				{/each}
			</div>
		{:else}
			<input
				class="border-muted/25 placeholder:text-muted/60 focus:border-muted/60 w-full rounded border bg-transparent px-3 py-2 text-xs outline-none"
				placeholder="Message the room"
			/>
		{/if}
	</div>
</aside>
