<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Copy, Plus, SmilePlus, X } from '@lucide/svelte';
	import ChatImage from '$lib/chat/ChatImage.svelte';
	import MessageText from '$lib/chat/MessageText.svelte';
	import { compressImage } from '$lib/chat/media';
	import { toasts } from '$lib/toast.svelte';
	import { keepSize } from '$lib/pane';

	// In media-focus the player lives in the main area, so the panel must not render a second one.
	let {
		live,
		showPlayer,
		player,
		queue = [],
		messages = [],
		slug = undefined,
		jamUrl = undefined,
		onAdd,
		onJam,
		onCheer,
		onChat,
		reactions = {},
		myReacts = {},
		onReact,
		cheers = ['🔥', '💪', '👏', '💀', '🚀', '🧊'],
	}: {
		live: boolean;
		showPlayer: boolean;
		/** The real player (the jukebox) renders into the panel's top slot. */
		player?: Snippet;
		queue?: { title: string; by?: string }[];
		/** Room chat — a bounded log since ADR-0010's amendment (#201). */
		messages?: {
			id?: string;
			from: string;
			text: string;
			imageId?: string;
			at: number;
		}[];
		/** Needed to address pasted images (#279); absent = text-only chat. */
		slug?: string;
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
		/** A pasted image rides along as a blob; the parent owns the upload. */
		onChat?: (text: string, image?: Blob) => void;
		/** The room's one emoji vocabulary (#223) — cheers thrown, reactions attached. */
		cheers?: string[];
	} = $props();

	// Any member can add (SPEC roles): paste is the golden path.
	let adding = $state(false);
	let url = $state('');

	let reactingTo = $state<string | null>(null);

	// Consecutive lines from one rider read as one turn — the header repeats
	// only after a gap, like every messenger.
	const GROUP_GAP_MS = 5 * 60_000;

	const clock = (at: number) =>
		new Date(at).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
		});

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toasts.push('Message copied');
		} catch {
			toasts.push('Copy needs clipboard permission', { tone: 'error' });
		}
	}

	let draft = $state('');
	// A pasted image waiting on the send button (#279) — Discord's flow:
	// Ctrl+V, see the chip, hit Enter.
	let pendingImage = $state<{ blob: Blob; preview: string } | null>(null);

	function clearPending() {
		if (pendingImage) URL.revokeObjectURL(pendingImage.preview);
		pendingImage = null;
	}

	async function pasteImage(e: ClipboardEvent) {
		const file = Array.from(e.clipboardData?.items ?? [])
			.find((item) => item.kind === 'file' && item.type.startsWith('image/'))
			?.getAsFile();
		if (!file) return; // text pastes stay the input's business
		e.preventDefault();
		const blob = await compressImage(file);
		if (!blob) {
			toasts.push('That image cannot be sent — GIFs are capped at 2 MB.', {
				tone: 'error',
			});
			return;
		}
		clearPending();
		pendingImage = { blob, preview: URL.createObjectURL(blob) };
	}

	function sendChat() {
		const text = draft.trim();
		if (!text && !pendingImage) return;
		onChat?.(text, pendingImage?.blob);
		draft = '';
		clearPending();
	}
</script>

<!-- Resizable (#280): `direction: rtl` puts the native resize grip on the
     panel's LEFT border — the edge you actually want to drag on a right-hand
     dock — and the inner wrapper puts writing direction back. -->
<aside
	{@attach (node) => keepSize(node, 'side-panel')}
	class="border-ink/5 h-full w-80 shrink-0 overflow-hidden border-l"
	style="direction: rtl; resize: horizontal; min-width: 240px; max-width: 40vw"
>
	<div class="flex h-full flex-col" style="direction: ltr">
		{#if showPlayer && player}
			<div class="border-ink/5 border-b p-3">
				{@render player()}
			</div>
		{/if}

		<div class="border-ink/5 border-b px-4 py-3">
			<div class="eyebrow flex items-center justify-between">
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

		<div class="eyebrow px-4 pt-3 pb-1">chat</div>
		<ul
			class="flex flex-1 flex-col justify-end space-y-2 overflow-x-hidden overflow-y-auto px-4 py-2"
		>
			{#each messages as message, i (message.id ?? message.at + message.from)}
				{@const grouped =
					i > 0 &&
					messages[i - 1].from === message.from &&
					message.at - messages[i - 1].at < GROUP_GAP_MS}
				<li class="group text-xs leading-snug {grouped ? '-mt-1.5' : ''}">
					<div class="flex items-baseline gap-1.5">
						{#if !grouped}
							<span class="text-muted min-w-0 truncate font-medium"
								>{message.from}</span
							>
							<span class="text-muted/40 shrink-0 font-mono text-[10px]"
								>{clock(message.at)}</span
							>
						{/if}
						<span
							class="ml-auto flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
						>
							{#if message.text}
								<button
									onclick={() => copy(message.text)}
									class="text-muted/60 hover:text-ink"
									aria-label="copy message"><Copy size={12} /></button
								>
							{/if}
							{#if message.id && onReact}
								{@const id = message.id}
								<button
									onclick={() => (reactingTo = reactingTo === id ? null : id)}
									class="text-muted/60 hover:text-ink"
									aria-label="react"><SmilePlus size={13} /></button
								>
							{/if}
						</span>
					</div>
					<!-- An image-only line has no text to render; MessageText turns a
				     lone GIF link into the GIF itself. -->
					{#if message.text}
						<div class="text-ink/85 wrap-anywhere">
							<MessageText text={message.text} />
						</div>
					{/if}
					{#if message.imageId && slug}
						<ChatImage
							src="/api/rooms/{slug}/chat/images/{message.imageId}"
							alt="Sent by {message.from}"
						/>
					{/if}
					{#if message.id && onReact}
						{@const id = message.id}
						{#if reactingTo === id}
							<span
								class="bg-surface-raised ring-ink/10 mt-1 inline-flex gap-0.5 rounded-full px-1.5 py-0.5 ring-1"
							>
								{#each cheers as emoji (emoji)}
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
											: 'ring-ink/10 bg-surface-raised'}"
										>{emoji} {count}</button
									>
								{/each}
							</span>
						{/if}
					{/if}
				</li>
			{:else}
				<li class="text-muted/60 text-xs">
					Warm-up talk lands here — the room keeps the recent history. Voice
					stays the main channel.
				</li>
			{/each}
		</ul>

		<div class="border-ink/5 border-t p-3">
			{#if !live}
				<!-- Typing is a lounge activity; mid-ride it collapses to reactions. -->
				{#if pendingImage}
					<div class="relative mb-2 inline-block">
						<img
							src={pendingImage.preview}
							alt="Ready to send"
							class="ring-ink/10 max-h-24 rounded ring-1"
						/>
						<button
							onclick={clearPending}
							class="bg-surface-raised ring-ink/10 text-muted hover:text-ink absolute -top-1.5 -right-1.5 rounded-full p-0.5 ring-1"
							aria-label="Remove image"><X size={12} /></button
						>
					</div>
				{/if}
				<form
					class="mb-2 flex gap-1.5"
					onsubmit={(e) => {
						e.preventDefault();
						sendChat();
					}}
				>
					<input
						bind:value={draft}
						onpaste={pasteImage}
						maxlength="500"
						placeholder="Say something…"
						class="input input-xs min-w-0 flex-1"
					/>
					<button
						disabled={!draft.trim() && !pendingImage}
						class="btn btn-secondary btn-xs">Send</button
					>
				</form>
			{/if}
			<!-- Mid-ride: typing is off the table, so the affordance is reactions, not a text field. -->
			<div class="flex gap-1.5">
				{#each cheers.slice(0, 4) as emoji (emoji)}
					<button
						onclick={() => onCheer?.(emoji)}
						class="border-muted/20 hover:border-muted/50 flex-1 rounded border py-2 text-base"
						>{emoji}</button
					>
				{/each}
			</div>
		</div>
	</div>
</aside>
