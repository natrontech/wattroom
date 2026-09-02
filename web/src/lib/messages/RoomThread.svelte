<script lang="ts">
	// A room's chat as a thread (#468) — readable and writable whether or
	// not you are in the room. Inside, it is the room connection's own log,
	// tick-fresh, with the room's events between the lines. Outside, it is
	// the backlog polled like a DM, and a post goes over HTTP; the hub hands
	// it to whoever is in there. Being in the room adds voice, the ride and
	// the jukebox — not the words.
	import {
		CalendarClock,
		ChevronLeft,
		Copy,
		Headphones,
		Image as ImageIcon,
		Music,
		Radio,
		RotateCw,
		SmilePlus,
		Users,
	} from '@lucide/svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import ChatImage from '$lib/chat/ChatImage.svelte';
	import ImageChip from '$lib/chat/ImageChip.svelte';
	import MessageText from '$lib/chat/MessageText.svelte';
	import Reactions from '$lib/chat/Reactions.svelte';
	import { createPendingImage } from '$lib/chat/pending-image.svelte';
	import { stickToBottom } from '$lib/chat/stick-to-bottom';
	import { uploadImage } from '$lib/chat/upload';
	import { account } from '$lib/account.svelte';
	import { formatTime } from '$lib/format';
	import { STOCK_CHEERS } from '$lib/icons';
	import { mentionsMe } from '$lib/messages/mention';
	import { createOutsideThread } from '$lib/messages/outside.svelte';
	import { presence } from '$lib/presence.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { addYouTubeUrl } from '$lib/room/jukebox-add';
	import { eventText, roomTimeline } from '$lib/room/timeline';
	import { toasts } from '$lib/toast.svelte';

	let { slug }: { slug: string } = $props();

	const room = $derived(presence.rooms.find((r) => r.slug === slug));
	const name = $derived(room?.name ?? slug);
	const cheers = $derived(room?.cheers ?? STOCK_CHEERS);
	// Standing in this room, the thread IS the room's chat: same log, same
	// socket, no second copy to keep in step.
	const conn = $derived(
		roomConnection.current?.slug === slug ? roomConnection.current : null,
	);

	let outside = $state<ReturnType<typeof createOutsideThread> | null>(null);
	$effect(() => {
		if (conn) {
			outside = null;
			return;
		}
		const thread = createOutsideThread(slug);
		thread.start();
		outside = thread;
		return () => {
			thread.close();
			outside = null;
		};
	});

	const messages = $derived(
		conn ? conn.live.chatLog : (outside?.messages ?? []),
	);
	const reactions = $derived(
		conn ? conn.live.chatReactions : (outside?.reactions ?? {}),
	);
	const myReacts = $derived(
		conn ? conn.live.myReacts : (outside?.myReacts ?? {}),
	);
	// What the room did rides only the tick (ADR-0022): from outside there
	// is nothing to interleave, and nothing missed.
	const timeline = $derived(
		roomTimeline(messages, conn ? conn.live.roomEvents : []),
	);
	const loading = $derived(!conn && (outside?.loading ?? true));
	const error = $derived(conn ? null : (outside?.error ?? null));

	// The "N new" line: above the first message from someone else since you
	// last opened the room. Only from outside — standing in the room is
	// reading it, and the sidebar already counts it that way.
	const me = $derived(account.me?.id);
	const readAt = $derived(outside?.readAt ?? null);
	const isNew = (m: { fromId?: string; at: number }) =>
		readAt !== null && m.fromId !== me && m.at > readAt;
	const newCount = $derived(messages.filter(isNew).length);
	const firstNewId = $derived(messages.find(isNew)?.id);

	// Queuing a link is a jukebox command, and the jukebox is the socket's:
	// from outside the card stays a card.
	const onQueue = $derived(
		conn
			? (url: string) => void addYouTubeUrl(url, conn.live.jukebox)
			: undefined,
	);

	// Consecutive lines from one rider read as one turn — the header repeats
	// only after a gap, like every messenger.
	const GROUP_GAP_MS = 5 * 60_000;

	let reactingTo = $state<string | null>(null);
	async function react(id: string, cheer: string) {
		reactingTo = null;
		if (conn) {
			conn.live.react(id, cheer);
			return;
		}
		const refused = await outside?.react(id, cheer);
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
		let refused: string | null = null;
		if (conn) {
			let imageId: string | undefined;
			if (image) {
				const up = await uploadImage(`/api/rooms/${slug}/chat/images`, image);
				if (up.ok) imageId = up.data.id;
				else refused = up.error.message;
			}
			if (!refused) conn.live.chat(text, imageId);
		} else {
			refused = (await outside?.send(text, image)) ?? null;
		}
		sending = false;
		sendError = refused;
		if (refused) draft = text; // a refused message is not a deleted one
	}
</script>

<header
	class="border-ink/5 flex h-[3.25rem] shrink-0 items-center gap-3 border-b px-5"
>
	<a
		href="/messages"
		class="text-muted hover:text-ink -ml-2 rounded p-1 md:hidden"
		aria-label="all messages"><ChevronLeft size={18} /></a
	>
	<span class="bg-surface grid h-7 w-7 shrink-0 place-items-center rounded">
		{#if room?.icon}
			<RoomIcon icon={room.icon} size={14} class="text-muted" />
		{:else}
			<Users size={14} class="text-muted" />
		{/if}
	</span>
	<span class="min-w-0">
		<span class="block truncate text-sm font-medium">{name}</span>
		<span class="text-muted flex items-center gap-1.5 truncate text-[11px]">
			{#if room?.riding?.length}<RidingBars size={8} />{/if}
			{room?.connected ?? 0} in the room
			{#if room?.voice?.length}
				· <Headphones size={10} /> {room.voice.length} in voice
			{/if}
			· {conn ? 'you are in this room' : 'you are reading from outside'}
		</span>
	</span>
	{#if conn}
		<a href="/r/{slug}" class="btn btn-secondary btn-xs ml-auto shrink-0"
			>Lounge</a
		>
	{:else}
		<!-- The way in — the one thing this page cannot give you. -->
		<a href="/r/{slug}" class="btn btn-accent btn-xs ml-auto shrink-0"
			><Radio size={13} /> Join the room</a
		>
	{/if}
</header>

<!-- `mt-auto` on the list, not `justify-end` on the box (#291): spare room
     goes above the oldest line, so overflow spills off the END edge. -->
<div
	{@attach stickToBottom}
	data-testid="thread-log"
	class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-4"
>
	<div class="flex h-full flex-col">
		<div class="mt-auto space-y-2">
			{#if loading}
				<Skeleton rows={4} class="mb-3 h-9" />
			{:else if error}
				<Banner tone="error">
					{error}
					{#snippet action()}
						<button
							onclick={() => outside?.retry()}
							class="btn btn-secondary btn-xs"
							><RotateCw size={12} /> Retry</button
						>
					{/snippet}
				</Banner>
			{:else if timeline.length === 0}
				<div class="mb-4 text-center">
					<p class="font-display text-base font-bold">{name}</p>
					<p class="text-muted mt-0.5 text-xs">
						Nothing said here yet. Say something — the room keeps its last 500
						lines, and whoever is in there sees it as you type it.
					</p>
				</div>
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
											src="/api/rooms/{slug}/chat/images/{message.imageId}"
											alt="Sent by {message.from}"
										/>
									{/if}
								</span>
								{#if message.id}
									{@const id = message.id}
									<Reactions
										{id}
										counts={reactions[id]}
										{myReacts}
										{cheers}
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
								{#if message.id}
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
	{#if sendError || conn?.live.refusal}
		<div class="mb-2">
			<Banner tone="error">{sendError ?? conn?.live.refusal}</Banner>
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
			placeholder={conn
				? `Message ${name}…`
				: `Message ${name} — you are not in the room, they still see it`}
			class="input min-w-0 flex-1"
		/>
		<button
			disabled={sending || (!draft.trim() && !pending.current)}
			class="btn btn-primary">Send</button
		>
	</form>
	<p class="text-muted/70 mt-1.5 text-[10px]">
		{#if conn}
			The lounge shows this same chat beside the people, the ride and the
			jukebox.
		{:else}
			Reactions and links work from here. Being in the room adds voice, the ride
			and queuing a link to the jukebox — not the words.
		{/if}
	</p>
</div>
