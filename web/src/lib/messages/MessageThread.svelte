<script lang="ts">
	// The thread body shared by every chat surface (#672): the timeline, the
	// four states (errors.md), the composer. A room's own header (who's in
	// there, the way in) and a DM's (where they are) stay with the caller —
	// what differs surface to surface is what a line IS and what you can do
	// to it, not how the log scrolls or the box sends.
	import {
		CalendarClock,
		Copy,
		Image as ImageIcon,
		ListPlus,
		Music,
		RotateCw,
		SmilePlus,
	} from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import ChatImage from '$lib/chat/ChatImage.svelte';
	import ImageChip from '$lib/chat/ImageChip.svelte';
	import { parseInline } from '$lib/chat/inline';
	import MessageText from '$lib/chat/MessageText.svelte';
	import Reactions from '$lib/chat/Reactions.svelte';
	import { createPendingImage } from '$lib/chat/pending-image.svelte';
	import { stickToBottom } from '$lib/chat/stick-to-bottom';
	import { account } from '$lib/account.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { formatTime } from '$lib/format';
	import { mentionsMe } from '$lib/messages/mention';
	import type { ThreadSource } from '$lib/messages/thread-types';
	import { eventText } from '$lib/room/timeline';
	import { toasts } from '$lib/toast.svelte';

	let {
		source,
		imageSrc,
		onQueue,
		composerPlaceholder,
		composerHint,
		extraSendError = null,
		emptyState,
	}: {
		source: ThreadSource;
		/** Builds a message's image URL — the room and DM endpoints differ. */
		imageSrc: (imageId: string) => string;
		/** Queuing a link is a jukebox command — room-only. */
		onQueue?: (url: string) => void;
		composerPlaceholder: string;
		composerHint?: string;
		/** A persistent banner unrelated to the last send attempt, e.g. a
		 *  room reconnecting with its queue full. */
		extraSendError?: string | null;
		emptyState: Snippet;
	} = $props();

	const timeline = $derived(source.timeline);
	const me = $derived(account.me?.id);

	// The "N new" line: above the first message from someone else since the
	// thread's readAt. A source with no readAt (never opened before, or the
	// notion doesn't apply) simply never draws one.
	const isNew = (m: { fromId?: string; at: number }) =>
		source.readAt !== null && m.fromId !== me && m.at > source.readAt;
	const messages = $derived(
		timeline.flatMap((e) => (e.kind === 'message' ? [e.message] : [])),
	);
	const newCount = $derived(messages.filter(isNew).length);
	const firstNewId = $derived(messages.find(isNew)?.id);

	// Consecutive lines from one rider read as one turn — the header repeats
	// only after a gap, like every messenger.
	const GROUP_GAP_MS = 5 * 60_000;

	let reactingTo = $state<string | null>(null);
	async function react(id: string, cheer: string) {
		reactingTo = null;
		const refused = await source.react?.(id, cheer);
		if (refused) toasts.push(refused, { tone: 'error' });
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toasts.push('Message copied');
		} catch {
			toasts.push('Copy needs clipboard permission', { tone: 'error' });
		}
	}

	// The first external link in a line — the same one LinkPreview would
	// unfurl. addYouTubeUrl already refuses anything that isn't a video or
	// playlist, so offering the item costs nothing when the guess is wrong.
	function firstLink(text: string): string | undefined {
		return parseInline(text, location.origin).find((p) => p.external)?.text;
	}

	// Touch and long-press have no hover strip to reveal Copy and React, and a
	// rider three metres from the screen cannot hit a 13px icon anyway (#663).
	// Same actions, same handlers — the hover strip stays as the shortcut.
	function messageMenu(message: { id?: string; text: string }): MenuEntry[] {
		const items: MenuEntry[] = [];
		if (message.text)
			items.push({
				label: 'Copy',
				icon: Copy,
				onSelect: () => void copy(message.text),
			});
		if (message.id && source.react) {
			const id = message.id;
			items.push({
				label: 'React',
				icon: SmilePlus,
				onSelect: () => (reactingTo = reactingTo === id ? null : id),
			});
		}
		const link = onQueue && message.text ? firstLink(message.text) : undefined;
		if (link) {
			const url = link;
			items.push({
				label: 'Queue the link',
				icon: ListPlus,
				onSelect: () => onQueue?.(url),
			});
		}
		return items;
	}

	let draft = $state('');
	let sending = $state(false);
	let sendError = $state<string | null>(null);
	const pending = createPendingImage((refusal) => (sendError = refusal));
	let filePicker = $state<HTMLInputElement | null>(null);

	async function send() {
		const text = draft.trim();
		const image = pending.take();
		if (!text && !image) return;
		draft = '';
		sending = true;
		const refused = await source.send(text, image);
		sending = false;
		sendError = refused;
		if (refused) draft = text; // a refused message is not a deleted one
	}
</script>

<!-- `mt-auto` on the list, not `justify-end` on the box (#291): spare room
     goes above the oldest line, so overflow spills off the END edge. -->
<div
	{@attach stickToBottom}
	data-testid="thread-log"
	class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-4"
>
	<div class="flex h-full flex-col">
		<div class="mt-auto space-y-2">
			{#if source.loading}
				<Skeleton rows={4} class="mb-3 h-9" />
			{:else if source.error && timeline.length === 0}
				<Banner tone="error">
					{source.error}
					{#snippet action()}
						<button
							onclick={() => source.retry()}
							class="btn btn-secondary btn-xs"
							><RotateCw size={12} /> Retry</button
						>
					{/snippet}
				</Banner>
			{:else if timeline.length === 0}
				{@render emptyState()}
			{:else}
				{#each timeline as entry, i (entry.key)}
					{#if entry.kind === 'event'}
						<!-- An event, not a message: no avatar, no reactions, nothing to
						     copy. The room talking about itself stays quieter than the
						     people in it. -->
						{@const Mark =
							entry.event.kind === 'session' ? CalendarClock : Music}
						<p
							class="text-muted/70 flex items-baseline gap-1.5 pl-9 text-[11px] italic"
						>
							<Mark size={11} class="shrink-0 translate-y-0.5 opacity-70" />
							<span class="min-w-0 wrap-anywhere">{eventText(entry.event)}</span
							>
						</p>
					{:else}
						{@const message = entry.message}
						{@const prev = timeline[i - 1]}
						{@const startsNew = !!message.id && message.id === firstNewId}
						{@const grouped =
							!startsNew &&
							prev?.kind === 'message' &&
							prev.message.from === message.from &&
							message.at - prev.at < GROUP_GAP_MS}
						{@const mention = mentionsMe(message.text, account.me?.displayName)}
						{#if startsNew}
							<div class="flex items-center gap-3 py-1" role="separator">
								<span class="bg-neon/60 h-px flex-1"></span>
								<span class="text-neon text-[10px] tracking-widest uppercase"
									>{newCount} new</span
								>
								<span class="bg-neon/60 h-px flex-1"></span>
							</div>
						{/if}
						<div
							data-testid="thread-message"
							class="group flex gap-2.5 {grouped ? '-mt-1' : ''}"
							title={MENU_HINT}
							{@attach contextMenu(() => messageMenu(message))}
						>
							<span class="w-7 shrink-0">
								{#if !grouped}<Avatar name={message.from} size={28} />{/if}
							</span>
							<span class="min-w-0 flex-1">
								{#if !grouped}
									<span class="flex items-baseline gap-2">
										<span class="text-sm font-medium">{message.from}</span>
										<span class="text-muted/40 font-mono text-[10px]"
											>{formatTime(message.at)}</span
										>
									</span>
								{/if}
								<!-- A line that names you gets the bar — there is no server
								     mention yet, this is "@" plus your first name. -->
								<span
									class="text-ink/85 block text-sm wrap-anywhere {mention
										? 'border-neon/60 bg-neon/5 -ml-2 rounded border-l-2 py-0.5 pl-2'
										: ''}"
								>
									{#if message.text}
										<MessageText text={message.text} {onQueue} />
									{/if}
									{#if message.imageId}
										<ChatImage
											src={imageSrc(message.imageId)}
											alt="Sent by {message.from}"
										/>
									{/if}
								</span>
								{#if message.id && source.reactions}
									{@const id = message.id}
									<Reactions
										{id}
										counts={source.reactions[id]}
										myReacts={source.myReacts}
										cheers={source.cheers ?? []}
										picking={reactingTo === id}
										onReact={(cheer) => void react(id, cheer)}
									/>
								{/if}
							</span>
							<span
								class="flex shrink-0 gap-1 self-start opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
							>
								{#if message.text}
									<button
										onclick={() => copy(message.text)}
										class="text-muted/60 hover:text-ink p-1"
										aria-label="copy message"><Copy size={13} /></button
									>
								{/if}
								{#if message.id && source.react}
									{@const id = message.id}
									<button
										onclick={() => (reactingTo = reactingTo === id ? null : id)}
										class="text-muted/60 hover:text-ink p-1"
										aria-label="react"><SmilePlus size={14} /></button
									>
								{/if}
							</span>
						</div>
					{/if}
				{/each}
			{/if}
		</div>
	</div>
</div>

<div class="border-ink/5 shrink-0 border-t px-5 py-3">
	{#if sendError || extraSendError || (source.error && timeline.length > 0)}
		<div class="mb-2">
			<Banner tone="error">{sendError ?? extraSendError ?? source.error}</Banner
			>
		</div>
	{/if}
	<ImageChip image={pending.current} onClear={pending.clear} />
	<form
		class="flex items-center gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			void send();
		}}
	>
		<input
			bind:this={filePicker}
			type="file"
			accept="image/*"
			class="hidden"
			onchange={(e) => {
				pending.pick(e.currentTarget.files?.[0]);
				e.currentTarget.value = '';
			}}
		/>
		<button
			type="button"
			onclick={() => filePicker?.click()}
			class="text-muted hover:text-ink rounded p-1"
			aria-label="attach an image"
			title="attach an image (or paste one)"><ImageIcon size={16} /></button
		>
		<input
			bind:value={draft}
			onpaste={pending.paste}
			maxlength="500"
			placeholder={composerPlaceholder}
			class="input min-w-0 flex-1"
		/>
		<button
			disabled={sending || (!draft.trim() && !pending.current)}
			class="btn btn-primary">Send</button
		>
	</form>
	{#if composerHint}
		<p class="text-muted/70 mt-1.5 text-[10px]">{composerHint}</p>
	{/if}
</div>
