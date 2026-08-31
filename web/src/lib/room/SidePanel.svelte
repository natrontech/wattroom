<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Copy, Music, SmilePlus, X } from '@lucide/svelte';
	import type { RoomEvent } from '$lib/protocol';
	import {
		eventText,
		roomTimeline,
		type TimelineMessage,
	} from '$lib/room/timeline';
	import ChatImage from '$lib/chat/ChatImage.svelte';
	import MessageText from '$lib/chat/MessageText.svelte';
	import { compressImage } from '$lib/chat/media';
	import { stickToBottom } from '$lib/chat/stick-to-bottom';
	import { toasts } from '$lib/toast.svelte';
	import { keepSize } from '$lib/pane';

	// The panel is chat plus one slot: the jukebox playlist owns the whole
	// queue surface (#286) — the panel used to render a second, read-only
	// copy of it right underneath, with its own add field that routed a
	// Spotify link to a feature that no longer exists (ADR-0018).
	let {
		live,
		player,
		messages = [],
		events = [],
		slug = undefined,
		onCheer,
		onChat,
		reactions = {},
		myReacts = {},
		onReact,
		cheers = ['🔥', '💪', '👏', '💀', '🚀', '🧊'],
	}: {
		live: boolean;
		/** The jukebox playlist renders into the panel's top slot. */
		player?: Snippet;
		/** Room chat — a bounded log since ADR-0010's amendment (#201). */
		messages?: TimelineMessage[];
		/** What the room did (#321) — jukebox lines, interleaved with the talking. */
		events?: RoomEvent[];
		/** Needed to address pasted images (#279); absent = text-only chat. */
		slug?: string;
		/** messageId → emoji → count (shared truth). */
		reactions?: Record<string, Record<string, number>>;
		/** "id:emoji" → I pressed it. */
		myReacts?: Record<string, boolean>;
		onReact?: (messageId: string, emoji: string) => void;
		onCheer?: (emoji: string) => void;
		/** A pasted image rides along as a blob; the parent owns the upload. */
		onChat?: (text: string, image?: Blob) => void;
		/** The room's one emoji vocabulary (#223) — cheers thrown, reactions attached. */
		cheers?: string[];
	} = $props();

	let reactingTo = $state<string | null>(null);

	// Chat is the room's timeline (#321): what riders typed and what the room
	// did, in one chronological list.
	const timeline = $derived(roomTimeline(messages, events));

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
		{#if player}
			<div class="border-ink/5 max-h-[62%] overflow-y-auto border-b p-4">
				{@render player()}
			</div>
		{/if}

		<div class="eyebrow px-4 pt-3 pb-1">chat</div>
		<!-- `mt-auto` on the list, not `justify-end` on the box (#291): the
		     spare room goes above the oldest line, so overflow spills off the
		     END edge and scrollback is reachable. -->
		<div
			{@attach stickToBottom}
			data-testid="chat-log"
			class="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-4 py-2"
		>
			<ul class="mt-auto space-y-2">
				{#each timeline as entry, i (entry.key)}
					{#if entry.kind === 'event'}
						<!-- An event, not a message: no avatar, no reactions, nothing to
					     copy. The room talking about itself stays quieter than the
					     people in it. -->
						<li
							class="text-muted/60 flex items-baseline gap-1.5 text-[11px] leading-snug"
						>
							<Music size={11} class="shrink-0 translate-y-0.5 opacity-70" />
							<span class="min-w-0 wrap-anywhere">{eventText(entry.event)}</span
							>
							<span class="text-muted/40 ml-auto shrink-0 font-mono text-[10px]"
								>{clock(entry.at)}</span
							>
						</li>
					{:else}
						{@const message = entry.message}
						{@const prev = timeline[i - 1]}
						{@const grouped =
							prev?.kind === 'message' &&
							prev.message.from === message.from &&
							message.at - prev.at < GROUP_GAP_MS}
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
											onclick={() =>
												(reactingTo = reactingTo === id ? null : id)}
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
					{/if}
				{:else}
					<li class="text-muted/60 text-xs">
						Warm-up talk lands here — the room keeps the recent history. Voice
						stays the main channel.
					</li>
				{/each}
			</ul>
		</div>

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
