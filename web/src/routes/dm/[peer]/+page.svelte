<script lang="ts">
	// A conversation, as a place (ADR-0020). It was a 320×384 box pinned
	// bottom-right, carrying a `right-[392px]` so it missed the jukebox dock:
	// it could not show who you were talking to, its scrollback was a
	// thumbnail, and it was a mode you had to remember you were in — the same
	// thing the ADR rejects switchable layouts for, applied to a conversation.
	//
	// Nothing is lost by promoting it. The room connection survives navigation
	// (#191), so reading a DM keeps you in the room and in voice.
	import { page } from '$app/state';
	import Avatar from '$lib/components/Avatar.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import ChatImage from '$lib/chat/ChatImage.svelte';
	import MessageText from '$lib/chat/MessageText.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import { compressImage } from '$lib/chat/media';
	import { stickToBottom } from '$lib/chat/stick-to-bottom';
	import { api } from '$lib/api';
	import { dm } from '$lib/dm/dm.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import { presence } from '$lib/presence.svelte';
	import { Radio, X } from '@lucide/svelte';

	interface Message {
		id: string;
		mine: boolean;
		text: string;
		imageId?: string;
		at: number;
	}

	const peerId = $derived(page.params.peer ?? '');
	const head = $derived(dmHeads.heads.find((h) => h.peerId === peerId));
	const peerName = $derived(head?.peerName ?? dm.open?.name ?? 'them');
	// Where they are, if anywhere — the one thing the drawer could never say.
	const inRoom = $derived(
		presence.rooms.find((room) => room.riders?.includes(peerName)),
	);
	const riding = $derived(!!inRoom?.riding?.includes(peerName));

	let messages = $state<Message[]>([]);
	let draft = $state('');
	let error = $state<string | null>(null);
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

	async function load(id: string, after: number) {
		const res = await api<{ messages: Message[] }>(
			`/api/dms/${id}${after ? `?after=${after}` : ''}`,
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
		if (!after) messages = res.data.messages;
		else if (fresh.length > 0) messages = [...messages, ...fresh];
		if (messages.length > 0 && (fresh.length > 0 || !after)) {
			// "Seen" only when you could actually have seen it — a thread left
			// open in a hidden tab must keep the badge (audit #219).
			if (!document.hidden) dm.stampSeen(id);
		}
	}

	$effect(() => {
		const id = peerId;
		messages = [];
		if (!id) return;
		dm.stampSeen(id);
		dmHeads.bump();
		void load(id, 0);
		// Polled, not a live wire: a note between rides (ADR-0012 amended).
		const timer = setInterval(
			() => void load(id, messages.at(-1)?.at ?? 0),
			5_000,
		);
		return () => clearInterval(timer);
	});

	async function send() {
		const text = draft.trim();
		const image = pendingImage;
		if (!peerId || (!text && !image)) return;
		draft = '';
		clearPending();
		// The image uploads first; the message then carries only its id.
		let imageId: string | undefined;
		if (image) {
			const up = await api<{ id: string }>(`/api/dms/${peerId}/images`, {
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
		const res = await api(`/api/dms/${peerId}`, {
			method: 'POST',
			json: { text, imageId },
		});
		if (!res.ok) {
			error = res.error.message;
			draft = text;
			return;
		}
		await load(peerId, messages.at(-1)?.at ?? 0);
	}
</script>

<div class="flex h-full min-h-0 flex-col">
	<!-- The header is what the drawer could never afford: who they are, whether
	     they are around, and the one thing you want from a friend who is
	     riding — the way in. -->
	<header
		class="border-ink/5 flex h-[3.25rem] shrink-0 items-center gap-3 border-b px-5"
	>
		<span class="relative shrink-0">
			<Avatar
				name={peerName}
				avatarUrl={head?.peerAvatarUrl}
				preset={head?.peerAvatarPreset}
				xp={head?.peerTotalXp}
				size={28}
			/>
			{#if riding}
				<span
					class="bg-surface ring-surface absolute -right-1 -bottom-1 rounded-full px-0.5 py-px ring-2"
				>
					<RidingBars size={8} />
				</span>
			{:else if inRoom}
				<span
					class="bg-z4 ring-surface absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2"
				></span>
			{/if}
		</span>
		<span class="min-w-0">
			<a
				href="/u/{peerId}"
				class="block truncate text-sm font-medium hover:underline"
				title="{peerName}'s page">{peerName}</a
			>
			<span class="text-muted block truncate text-[11px]">
				{#if riding}riding in {inRoom?.name}{:else if inRoom}in {inRoom.name}{:else}not
					in a room{/if}
			</span>
		</span>
		{#if inRoom}
			<a href="/r/{inRoom.slug}" class="btn btn-accent btn-xs ml-auto shrink-0"
				><Radio size={13} /> Join them</a
			>
		{/if}
	</header>

	<div {@attach stickToBottom} class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
		<div class="flex h-full flex-col">
			<div class="mt-auto space-y-2">
				{#if messages.length === 0}
					<div class="mb-4 text-center">
						<Avatar name={peerName} size={48} />
						<p class="font-display mt-2 text-base font-bold">{peerName}</p>
						<p class="text-muted mt-0.5 text-xs">
							Just you two — messages stay between friends, last 500 kept.
						</p>
					</div>
				{/if}
				{#each messages as message, i (message.id)}
					{@const grouped = messages[i - 1]?.mine === message.mine}
					<div class="flex gap-2.5 {grouped ? '-mt-1' : ''}">
						<span class="w-7 shrink-0">
							{#if !grouped}
								<Avatar name={message.mine ? 'You' : peerName} size={28} />
							{/if}
						</span>
						<span class="min-w-0 flex-1">
							{#if !grouped}
								<span class="flex items-baseline gap-2">
									<span class="text-sm font-medium"
										>{message.mine ? 'You' : peerName}</span
									>
									<span class="text-muted/40 font-mono text-[10px]"
										>{new Date(message.at).toLocaleTimeString([], {
											hour: '2-digit',
											minute: '2-digit',
										})}</span
									>
								</span>
							{/if}
							{#if message.text}
								<span class="text-ink/85 block text-sm wrap-anywhere"
									><MessageText text={message.text} /></span
								>
							{/if}
							{#if message.imageId}
								<ChatImage
									src="/api/dms/images/{message.imageId}"
									alt={message.mine ? 'Image you sent' : 'Image you received'}
								/>
							{/if}
						</span>
					</div>
				{/each}
			</div>
		</div>
	</div>

	<div class="border-ink/5 shrink-0 border-t px-5 py-3">
		<div>
			{#if error}
				<div class="mb-2"><Banner tone="error">{error}</Banner></div>
			{/if}
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
				class="flex gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					void send();
				}}
			>
				<input
					bind:value={draft}
					onpaste={pasteImage}
					maxlength="500"
					placeholder="Message {peerName}…"
					class="input min-w-0 flex-1"
				/>
				<button
					disabled={!draft.trim() && !pendingImage}
					class="btn btn-primary">Send</button
				>
			</form>
		</div>
	</div>
</div>
