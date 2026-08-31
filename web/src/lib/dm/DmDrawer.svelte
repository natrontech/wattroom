<script lang="ts">
	import { X } from '@lucide/svelte';
	import { api } from '$lib/api';
	import ChatImage from '$lib/chat/ChatImage.svelte';
	import MessageText from '$lib/chat/MessageText.svelte';
	import { compressImage } from '$lib/chat/media';
	import { stickToBottom } from '$lib/chat/stick-to-bottom';
	import { dm } from '$lib/dm/dm.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';

	// The DM drawer (#208): one thread, bottom-right, polled — a note between
	// rides, not a live wire (ADR-0012 amended).
	interface Message {
		id: string;
		mine: boolean;
		text: string;
		imageId?: string;
		at: number;
	}

	let messages = $state<Message[]>([]);
	let draft = $state('');
	let error = $state<string | null>(null);
	// A pasted image waiting on send (#285) — same flow as room chat.
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
			error = 'That image cannot be sent — GIFs are capped at 2 MB.';
			return;
		}
		clearPending();
		error = null;
		pendingImage = { blob, preview: URL.createObjectURL(blob) };
	}

	async function load(peerId: string, after: number) {
		const res = await api<{ messages: Message[] }>(
			`/api/dms/${peerId}${after ? `?after=${after}` : ''}`,
		);
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		// `after` is millisecond-truncated, so the boundary message can come
		// back — merge by id, never blind-append.
		const seen = new Set(messages.map((m) => m.id));
		const fresh = res.data.messages.filter((m) => !seen.has(m.id));
		if (!after) {
			messages = res.data.messages;
		} else if (fresh.length > 0) {
			messages = [...messages, ...fresh];
		}
		if (messages.length > 0 && (fresh.length > 0 || !after)) {
			// "Seen" only when you could actually have seen it — a drawer left
			// open in a hidden tab must keep the badge (audit #219).
			if (!document.hidden) dm.stampSeen(peerId);
		}
	}

	$effect(() => {
		const peer = dm.open;
		messages = [];
		if (!peer) return;
		void load(peer.id, 0);
		const timer = setInterval(
			() => void load(peer.id, messages.at(-1)?.at ?? 0),
			5_000,
		);
		return () => clearInterval(timer);
	});

	async function send() {
		const peer = dm.open;
		const text = draft.trim();
		const image = pendingImage;
		if (!peer || (!text && !image)) return;
		draft = '';
		clearPending();
		// The image uploads first; the message then carries only its id.
		let imageId: string | undefined;
		if (image) {
			const up = await api<{ id: string }>(`/api/dms/${peer.id}/images`, {
				method: 'POST',
				body: image.blob,
				headers: { 'content-type': image.blob.type },
			});
			if (!up.ok) {
				error = up.error.message;
				draft = text; // a refused message is not a deleted one
				return;
			}
			imageId = up.data.id;
		}
		const res = await api(`/api/dms/${peer.id}`, {
			method: 'POST',
			json: { text, imageId },
		});
		if (!res.ok) {
			error = res.error.message;
			draft = text;
			return;
		}
		await load(peer.id, messages.at(-1)?.at ?? 0);
	}
</script>

{#if dm.open}
	<div
		class="bg-surface-raised ring-ink/15 fixed bottom-4 z-50 flex h-96 w-80 flex-col rounded-lg shadow-lg ring-1 {roomConnection
			.current?.live.tick?.jukebox?.current
			? 'right-[392px]'
			: 'right-4'}"
		role="dialog"
		aria-label="messages with {dm.open.name}"
	>
		<div class="border-ink/5 flex items-center gap-2 border-b px-3 py-2">
			<span class="truncate text-sm font-medium">{dm.open.name}</span>
			<button
				onclick={() => dm.close()}
				class="text-muted hover:text-ink ml-auto"
				aria-label="close messages"><X size={14} /></button
			>
		</div>
		<div
			{@attach stickToBottom}
			class="min-h-0 flex-1 space-y-1.5 overflow-x-hidden overflow-y-auto p-3"
		>
			{#each messages as message (message.id)}
				<div class="flex {message.mine ? 'justify-end' : ''}">
					<span
						class="max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs leading-snug wrap-anywhere {message.mine
							? 'bg-neon/20'
							: 'bg-surface'}"
					>
						<!-- An image-only line has no text; MessageText turns a lone
						     GIF link into the GIF itself. -->
						{#if message.text}
							<MessageText text={message.text} />
						{/if}
						{#if message.imageId}
							<ChatImage
								src="/api/dms/images/{message.imageId}"
								alt={message.mine ? 'Image you sent' : 'Image you received'}
							/>
						{/if}
					</span>
				</div>
			{:else}
				<p class="text-muted/60 text-xs">
					Just you two — messages stay between friends, last 500 kept.
				</p>
			{/each}
			{#if error}<p class="text-z6 text-xs">{error}</p>{/if}
		</div>
		<div class="border-ink/5 border-t p-2">
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
				class="flex gap-1.5"
				onsubmit={(e) => {
					e.preventDefault();
					void send();
				}}
			>
				<input
					bind:value={draft}
					onpaste={pasteImage}
					maxlength="500"
					placeholder="Message {dm.open.name}…"
					class="input input-xs min-w-0 flex-1"
				/>
				<button
					disabled={!draft.trim() && !pendingImage}
					class="btn btn-primary btn-xs">Send</button
				>
			</form>
		</div>
	</div>
{/if}
