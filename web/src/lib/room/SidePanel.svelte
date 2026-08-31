<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Plus, SmilePlus } from '@lucide/svelte';

	// In media-focus the player lives in the main area, so the panel must not render a second one.
	let {
		live,
		showPlayer,
		player,
		queue = [],
		messages = [],
		jamUrl = undefined,
		onAdd,
		onJam,
		onCheer,
		onChat,
		reactions = {},
		myReacts = {},
		onReact,
	}: {
		live: boolean;
		showPlayer: boolean;
		/** The real player (the jukebox) renders into the panel's top slot. */
		player?: Snippet;
		queue?: { title: string; by?: string }[];
		/** Room chat — a bounded log since ADR-0010's amendment (#201). */
		messages?: { id?: string; from: string; text: string; at: number }[];
		/** messageId → emoji → count (shared truth). */
		reactions?: Record<string, Record<string, number>>;
		/** "id:emoji" → I pressed it. */
		myReacts?: Record<string, boolean>;
		onReact?: (messageId: string, emoji: string) => void;
		onAdd?: (url: string) => void;
		/** Spotify Jam link-out (#96) — set/clear from the add expander. */
		jamUrl?: string;
		onJam?: (url: string) => void;
		onCheer?: (emoji: string) => void;
		onChat?: (text: string) => void;
	} = $props();

	// Any member can add (SPEC roles): paste is the golden path.
	let adding = $state(false);
	let url = $state('');

	// The room's one emoji vocabulary — cheers thrown, reactions attached.
	const reactEmoji = ['🔥', '💪', '👏', '💀', '🚀', '🧊'];
	let reactingTo = $state<string | null>(null);

	let draft = $state('');
	function sendChat() {
		const text = draft.trim();
		if (!text) return;
		draft = '';
		onChat?.(text);
	}
</script>

<aside class="border-ink/5 flex h-full w-80 shrink-0 flex-col border-l">
	{#if showPlayer && player}
		<div class="border-ink/5 border-b p-3">
			{@render player()}
		</div>
	{/if}

	<div class="border-ink/5 border-b px-4 py-3">
		<div
			class="text-muted flex items-center justify-between text-[10px] tracking-[0.2em] uppercase"
		>
			<span>queue</span>
			<button
				onclick={() => (adding = !adding)}
				class="text-muted hover:text-ink"
				aria-label="Add to queue"
				>{#if adding}close{:else}<Plus size={13} />{/if}</button
			>
		</div>

		{#if adding}
			<form
				class="mt-2"
				onsubmit={(e) => {
					e.preventDefault();
					const raw = url.trim();
					if (!raw) return;
					// One field, two services: a Spotify link becomes the Jam card,
					// anything else goes to the YouTube queue.
					if (/spotify\.link|spotify\.com/.test(raw)) onJam?.(raw);
					else onAdd?.(raw);
					url = '';
					adding = false;
				}}
			>
				<input
					bind:value={url}
					class="border-muted/25 placeholder:text-muted/60 w-full rounded border bg-transparent px-3 py-2 text-xs outline-none"
					placeholder="Paste a YouTube or Spotify Jam link"
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
					<span class="{i === 0 ? 'text-ink' : 'text-muted'} truncate"
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
		chat
	</div>
	<ul
		class="flex flex-1 flex-col justify-end space-y-2 overflow-y-auto px-4 py-2"
	>
		{#each messages as message (message.id ?? message.at + message.from)}
			<li class="group text-xs leading-snug">
				<span class="text-muted font-medium">{message.from}</span>
				<span class="text-ink/85 ml-1.5">{message.text}</span>
				{#if message.id && onReact}
					{@const id = message.id}
					<button
						onclick={() => (reactingTo = reactingTo === id ? null : id)}
						class="text-muted/60 hover:text-ink ml-1.5 opacity-0 transition-opacity group-hover:opacity-100 {reactingTo ===
						id
							? 'opacity-100'
							: ''}"
						aria-label="react"><SmilePlus size={13} /></button
					>
					{#if reactingTo === id}
						<span
							class="bg-surface-raised ring-ink/10 ml-1 inline-flex gap-0.5 rounded-full px-1.5 py-0.5 ring-1"
						>
							{#each reactEmoji as emoji (emoji)}
								<button
									onclick={() => {
										onReact(id, emoji);
										reactingTo = null;
									}}
									class="px-0.5 hover:scale-125">{emoji}</button
								>
							{/each}
						</span>
					{/if}
					{#if reactions[id]}
						<span class="mt-0.5 flex flex-wrap gap-1">
							{#each Object.entries(reactions[id]).filter(([, n]) => n > 0) as [emoji, count] (emoji)}
								<button
									onclick={() => onReact(id, emoji)}
									class="rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ring-1 {myReacts[
										`${id}:${emoji}`
									]
										? 'ring-neon bg-neon/15'
										: 'ring-ink/10 bg-surface-raised'}">{emoji} {count}</button
								>
							{/each}
						</span>
					{/if}
				{/if}
			</li>
		{:else}
			<li class="text-muted/60 text-xs">
				Warm-up talk lands here — the room keeps the recent history. Voice stays
				the main channel.
			</li>
		{/each}
	</ul>

	<div class="border-ink/5 border-t p-3">
		{#if !live}
			<!-- Typing is a lounge activity; mid-ride it collapses to reactions. -->
			<form
				class="mb-2 flex gap-1.5"
				onsubmit={(e) => {
					e.preventDefault();
					sendChat();
				}}
			>
				<input
					bind:value={draft}
					maxlength="500"
					placeholder="Say something…"
					class="border-muted/25 focus:border-muted/60 min-w-0 flex-1 rounded border bg-transparent px-3 py-1.5 text-xs outline-none"
				/>
				<button
					disabled={!draft.trim()}
					class="border-muted/25 hover:border-muted/60 rounded border px-3 py-1.5 text-xs disabled:opacity-40"
					>Send</button
				>
			</form>
		{/if}
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
