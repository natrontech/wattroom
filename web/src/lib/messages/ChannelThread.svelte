<script lang="ts">
	// A text channel's chat (#2448, ADR-0058): a name, a gate and a
	// scrollback. Read and written over HTTP only — there is no socket to
	// join, so hopping from one channel to the next is navigation and
	// nothing more. The backlog is read again on the lobby ping every chat
	// write raises (#2435).
	//
	// The body (timeline, states, composer, focus) is MessageThread.svelte,
	// shared with a DM's; this supplies the channel's endpoints and what the
	// viewer's crew role allows.
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Hash from '@lucide/svelte/icons/hash';
	import Lock from '@lucide/svelte/icons/lock';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import AnnouncementStrip from '$lib/announce/AnnouncementStrip.svelte';
	import { takeDownAnnouncement } from '$lib/announce/take-down';
	import type { CrewChannel } from '$lib/channels';
	import type { Crew } from '$lib/crew';
	import { banFromCrewFlow } from '$lib/crew-flows';
	import { provideCrewEmoji } from '$lib/emoji/crew-emoji.svelte';
	import { STOCK_CHEERS } from '$lib/icons';
	import MessageThread from '$lib/messages/MessageThread.svelte';
	import {
		createChatThread,
		type ChatThread,
	} from '$lib/messages/chat-thread.svelte';
	import type { ThreadSource } from '$lib/messages/thread-types';
	import { people } from '$lib/people.svelte';
	import { presence } from '$lib/presence.svelte';
	import { messageTimeline } from '$lib/messages/timeline';
	import { toasts } from '$lib/toast.svelte';
	import { untrack } from 'svelte';

	let { crew, channel }: { crew: Crew; channel: CrewChannel } = $props();

	// The crew's own emoji draw in its lines and reactions (#2643).
	provideCrewEmoji(() => crew.id);

	const base = $derived(`/api/channels/${channel.id}`);
	// The crew's owner and admins keep its channels (docs/SPEC.md): they
	// mark the announcement and take anyone's line down.
	const administers = $derived(crew.role === 'owner' || crew.role === 'admin');

	// The crew's ban from the line (#2530): the owner and admins, never on the
	// owner's lines (docs/SPEC.md); your own drops it in personMenu.
	const banOf = (id: string, displayName: string) =>
		administers && crew.people.find((p) => p.id === id)?.role !== 'owner'
			? () => void banFromCrewFlow(crew, { id, displayName })
			: undefined;

	let thread = $state<ChatThread | null>(null);
	$effect(() => {
		const opened = createChatThread(base);
		opened.start();
		thread = opened;
		return () => {
			opened.close();
			thread = null;
		};
	});
	let heard = untrack(() => presence.version);
	$effect(() => {
		const version = presence.version;
		if (version === heard) return;
		heard = version;
		untrack(() => thread?.reload());
	});

	// Who `@` completes to (#1766): the crew, an offline member most of all.
	$effect(() => {
		people.learn(crew.people.map((p) => ({ ...p, name: p.displayName })));
	});
	const mentionNames = $derived(crew.people.map((p) => p.displayName));

	const timeline = $derived(messageTimeline(thread?.messages ?? []));

	async function mark(messageId: string) {
		const res = await api(`${base}/announcement`, {
			method: 'PUT',
			json: { messageId },
		});
		toasts.push(
			res.ok ? 'Announcement is up.' : res.error.message,
			res.ok ? undefined : { tone: 'error' },
		);
		if (res.ok) thread?.reload();
	}

	const clear = () =>
		takeDownAnnouncement(channel.id, thread?.announcement?.messageId, () =>
			thread?.reload(),
		);

	const source: ThreadSource = $derived({
		timeline,
		loading: thread?.loading ?? true,
		error: thread?.error ?? null,
		readAt: thread?.readAt ?? null,
		reactions: thread?.reactions ?? {},
		myReacts: thread?.myReacts ?? {},
		// The crew's set, not the stock one (#2643, the text-channel twin of
		// #2521); [] means the crew never changed it.
		cheers: crew.cheers?.length ? crew.cheers : STOCK_CHEERS,
		crewId: crew.id,
		retry: () => thread?.retry(),
		send: async (text, image, expiresIn) =>
			(await thread?.send(text, image, expiresIn)) ?? null,
		react: async (id, cheer) => (await thread?.react(id, cheer)) ?? null,
		edit: async (id, text) => (await thread?.edit(id, text)) ?? null,
		remove: async (id) => (await thread?.remove(id)) ?? null,
		canRemove: (message) =>
			!!message.fromId && (message.fromId === account.me?.id || administers),
		announce: administers ? (id) => void mark(id) : undefined,
		banOf,
	});
</script>

<header
	class="border-ink/5 flex h-[3.25rem] shrink-0 items-center gap-3 border-b px-5"
>
	<a
		href="/crew/{crew.id}"
		class="text-muted hover:text-ink -ml-2 rounded p-1 md:hidden"
		aria-label="back to {crew.name}"><ChevronLeft size={18} /></a
	>
	<span class="bg-surface grid h-7 w-7 shrink-0 place-items-center rounded">
		{#if channel.private}
			<Lock size={14} class="text-muted" />
		{:else}
			<Hash size={14} class="text-muted" />
		{/if}
	</span>
	<span class="min-w-0">
		<h1 class="block truncate text-sm font-medium">{channel.name}</h1>
		<a
			href="/crew/{crew.id}"
			class="text-muted hover:text-ink block truncate text-[11px]"
			>{crew.name}</a
		>
	</span>
</header>

{#if thread?.announcement}
	<div class="px-5 pt-4">
		<AnnouncementStrip
			announcement={thread.announcement}
			canClear={administers}
			onclear={() => void clear()}
		/>
	</div>
{/if}

<MessageThread
	{source}
	imageSrc={(imageId) => `${base}/chat/images/${imageId}`}
	{mentionNames}
	composerPlaceholder={`Message ${channel.name}…`}
	editHint="Escape cancels · the channel sees the change"
	lineGapMs={0}
>
	{#snippet emptyState()}
		<!-- Clear of the floating nav and people buttons below md (#634). -->
		<div class="mb-4 px-16 text-center md:px-0">
			<p class="font-display text-base font-bold">{channel.name}</p>
			<p class="text-muted mt-0.5 text-xs">
				Nothing said here yet. Say something — the channel keeps its last 500
				lines, and the crew reads them whenever they look in.
			</p>
		</div>
	{/snippet}
</MessageThread>
