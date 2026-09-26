<script lang="ts" module>
	/** The decisions this page deliberately does not make. */
	const questions = [
		{
			q: 'A DM gets a dot, never a count.',
			today:
				'a DM only knows "something is new", from a localStorage stamp the reader keeps.',
			other:
				'count DMs too, which means a server-side read position per conversation.',
			cost: 'A dot cannot be sorted by urgency. Counting DMs is a schema change (expand/contract) and makes "seen" a server fact, which ADR-0012 deliberately did not.',
		},
		{
			q: 'Nothing adds up what is waiting.',
			today:
				'a dot per DM in the sidebar, no total anywhere; below md the sidebar is a drawer, so the whole signal can be off screen.',
			other:
				'a total on the messages entry and on the drawer button — unreadSummary in this mock.',
			cost: 'A number on the way in is the first ask, and the cheapest thing here: a derived value over data the client already has. What it must not do is glow.',
		},
	];
</script>

<script lang="ts">
	// MOCK (#451) — the states the rider report argues about, drawn on the
	// SHIPPED rules: orderThreads orders this list, unread-marks paints the
	// badges. Only the data is fake. Where a question is still open the page
	// shows both answers rather than quietly picking one.
	import Avatar from '$lib/components/Avatar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import MessageText from '$lib/chat/MessageText.svelte';
	import Reactions from '$lib/chat/Reactions.svelte';
	import { stickToBottom } from '$lib/chat/stick-to-bottom';
	import { contextMenu, MENU_HINT } from '$lib/context-menu.svelte';
	import type { MenuEntry } from '$lib/context-menu.svelte';
	import { formatTime } from '$lib/format';
	import { mentionsMe } from '$lib/messages/mention';
	import { formatThreadWhen, orderThreads } from '$lib/messages/threads';
	import type { Thread } from '$lib/messages/threads';
	import {
		UNREAD_COUNT,
		UNREAD_DOT,
		unreadCount,
	} from '$lib/messages/unread-marks';
	import { toasts } from '$lib/toast.svelte';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Menu from '@lucide/svelte/icons/menu';
	import MessagesSquare from '@lucide/svelte/icons/messages-square';
	import Search from '@lucide/svelte/icons/search';
	import UserRound from '@lucide/svelte/icons/user-round';
	import {
		backlog,
		dmUnread,
		heads,
		NOW,
		OPEN,
		readAt,
		unreadSummary,
	} from './mock';

	const threads = orderThreads(heads, dmUnread);
	const summary = unreadSummary(threads);
	const openKey = `dm:${OPEN}`;
	const peer = heads.find((h) => h.peerId === OPEN)!;

	const ME = 'Jan Lauber';
	const isNew = (m: { fromId?: string; at: number }) =>
		m.at > readAt && m.fromId !== 'jan';
	const newCount = backlog.filter(isNew).length;
	const firstNewId = backlog.find(isNew)?.id;

	// Nothing here changes anything — the menu proves the shape and says so.
	const nothing = (what: string) => () =>
		toasts.push(`${what} — mock, nothing happened`);

	const menu: MenuEntry[] = [
		{ label: 'Mark as read', icon: CheckCheck, onSelect: nothing('Marked') },
		{ label: 'Mute', icon: BellOff, onSelect: nothing('Muted') },
		'separator',
		{ label: 'Open the profile', icon: UserRound, onSelect: nothing('Opened') },
		{
			label: 'Hide the conversation',
			icon: EyeOff,
			danger: true,
			onSelect: nothing('Hidden'),
		},
	];

	/** Which answer surface 2 is drawn for — the one thing on this page you can toggle. */
	let total = $state(true);
</script>

{#snippet row(t: Thread)}
	{@const on = t.key === openKey}
	<li>
		<a
			href="#thread"
			aria-current={on ? 'page' : undefined}
			title={MENU_HINT}
			{@attach contextMenu(() => menu)}
			class="flex items-center gap-2.5 rounded px-2 py-2 {on
				? 'bg-surface-raised'
				: 'hover:bg-surface-raised/60'}"
		>
			<Avatar name={t.name} size={32} />
			<span class="min-w-0 flex-1">
				<span class="flex items-baseline gap-2">
					<span class="truncate text-sm {t.unread ? 'font-semibold' : ''}"
						>{t.name}</span
					>
					<span class="text-muted-dim ml-auto shrink-0 font-mono text-[10px]"
						>{formatThreadWhen(t.at, NOW)}</span
					>
				</span>
				<span class="flex items-center gap-1.5">
					<span
						class="min-w-0 flex-1 truncate text-xs {t.unread
							? 'text-ink/80'
							: 'text-muted'}">{t.preview}</span
					>
					{#if t.unread}
						<span class={UNREAD_DOT} title="new since you last read it"></span>
					{/if}
				</span>
			</span>
		</a>
	</li>
{/snippet}

{#snippet list()}
	<div class="px-3 pt-3 pb-2">
		<span class="input input-xs flex items-center gap-2">
			<Search size={12} class="text-muted shrink-0" />
			<span class="text-muted-dim min-w-0 flex-1 truncate">Search messages</span
			>
		</span>
	</div>
	<ul class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
		{#each threads as t (t.key)}{@render row(t)}{/each}
	</ul>
{/snippet}

{#snippet thread(narrow: boolean)}
	<header
		class="border-ink/5 flex h-[3.25rem] shrink-0 items-center gap-3 border-b px-5"
	>
		{#if narrow}
			<span class="text-muted -ml-2 p-1"><ChevronLeft size={18} /></span>
		{/if}
		<Avatar name={peer.peerName} size={28} />
		<span class="min-w-0">
			<span class="block truncate text-sm font-medium">{peer.peerName}</span>
			<span class="text-muted block truncate text-[11px]">your friend</span>
		</span>
	</header>
	<!-- The real log's own pinning, so a frame too short for the backlog opens
	     on the newest line the way the thread does. -->
	<div {@attach stickToBottom} class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
		<div class="space-y-2">
			{#each backlog as m (m.id)}
				{#if m.id === firstNewId}
					<div class="flex items-center gap-3 py-1" role="separator">
						<span class="bg-neon/60 h-px flex-1"></span>
						<span class="text-ink text-[10px] tracking-widest uppercase"
							>{newCount} new</span
						>
						<span class="bg-neon/60 h-px flex-1"></span>
					</div>
				{/if}
				<div class="flex gap-2.5">
					<span class="w-7 shrink-0"><Avatar name={m.from} size={28} /></span>
					<span class="min-w-0 flex-1">
						<span class="flex items-baseline gap-2">
							<span class="text-sm font-medium">{m.from}</span>
							<span class="text-muted-dim font-mono text-[10px]"
								>{formatTime(m.at)}</span
							>
						</span>
						<span
							class="text-ink/85 block text-sm wrap-anywhere {mentionsMe(
								m.text,
								ME,
							)
								? 'border-neon/60 bg-neon/5 -ml-2 rounded border-l-2 py-0.5 pl-2'
								: ''}"><MessageText text={m.text} /></span
						>
						<Reactions
							id={m.id}
							counts={m.reactions}
							onReact={nothing('Reacted')}
						/>
					</span>
				</div>
			{/each}
		</div>
	</div>
	<div class="border-ink/5 shrink-0 border-t px-5 py-3">
		<div class="flex items-center gap-2">
			<span class="text-muted p-1"><ImageIcon size={16} /></span>
			<span class="input text-muted-dim min-w-0 flex-1 truncate"
				>Message {peer.peerName}…</span
			>
			<span class="btn btn-primary">Send</span>
		</div>
	</div>
{/snippet}

<main class="mx-auto max-w-6xl px-6 py-12">
	<p class="eyebrow">mock · #451</p>
	<h1 class="page-title mt-2">Chat as a place</h1>
	<p class="text-muted mt-3 max-w-3xl text-sm">
		Jan's report: what is waiting for you should be visible from wherever you
		are. Messages shipped with #468 (ADR-0020), and a crew's chat moved to its
		text channels (ADR-0058) — so this page is the direct messages' states
		beside each other, so what is left can be decided by looking. Every badge,
		every ordering and every “N new” line here is the real module over fake
		data, and each frame names the file that draws the real one.
	</p>

	<h2 class="eyebrow mt-12">1 · The messages place</h2>
	<p class="text-muted mt-2 max-w-3xl text-xs">
		Every direct message in one list, ordered by <code>orderThreads</code>:
		unread first, then whoever spoke last — Sven sits above Nina's newer line
		because you have not read his. The “{newCount} new” rule and the mention bar take
		<code>--color-neon</code>: an unread mark is chrome, and ADR-0005 gives the
		glow to live data alone. Right-click any row. Real:
		<code>lib/messages/ThreadList.svelte</code> and
		<code>lib/messages/MessageThread.svelte</code>.
	</p>
	<!-- The desk shape keeps its width and scrolls sideways inside its own box:
	     a gallery of a wide screen must not make this page scroll sideways. -->
	<div class="mt-4 overflow-x-auto">
		<div
			class="border-muted/15 bg-surface grid h-[34rem] min-w-[56rem] grid-cols-[19rem_minmax(0,1fr)] overflow-hidden rounded-lg border"
		>
			<aside class="border-ink/5 flex min-h-0 flex-col border-r">
				{@render list()}
			</aside>
			<section id="thread" class="flex min-h-0 flex-col">
				{@render thread(false)}
			</section>
		</div>
	</div>

	<h2 class="eyebrow mt-12">2 · The signal on the way in</h2>
	<p class="text-muted mt-2 max-w-3xl text-xs">
		Something is waiting in a conversation you are not looking at. Today only
		the row's dot says so.
	</p>
	<div class="border-muted/15 bg-surface mt-4 max-w-md rounded-lg border p-3">
		<p class="text-muted text-[11px]">
			On the way in —
			<button
				onclick={() => (total = !total)}
				class="text-ink underline underline-offset-2"
				>{total ? 'with a total' : 'per-thread only'}</button
			>
			(open question, click to swap)
		</p>
		<div class="mt-2 space-y-1">
			<div
				class="border-ink/10 flex items-center gap-2 rounded border px-2 py-1.5"
			>
				<Menu size={14} class="text-muted" />
				<span class="text-muted text-xs">the sidebar, as a drawer below md</span
				>
				{#if total}<span class="{UNREAD_COUNT} ml-auto"
						>{unreadCount(summary.count)}</span
					>{/if}
			</div>
			<div class="flex items-center gap-2 px-2 py-1.5">
				<MessagesSquare size={14} class="text-muted" />
				<span class="text-muted text-xs">messages</span>
				{#if total}<span class="{UNREAD_COUNT} ml-auto"
						>{unreadCount(summary.count)}</span
					>{/if}
			</div>
		</div>
		<p class="text-muted-dim mt-2 text-[11px]">
			Nothing sums anything up today. With the sidebar collapsed into its
			drawer,
			{summary.count} conversation is waiting behind a button that says nothing —
			which is Jan's first ask, on a phone.
			<code>unreadSummary</code> in this mock's fixtures is the proposal; it
			belongs beside <code>orderThreads</code> if we take it.
		</p>
	</div>

	<h2 class="eyebrow mt-12">3 · The same states on a phone</h2>
	<p class="text-muted mt-2 max-w-3xl text-xs">
		Below <code>md</code> the list and the thread are two screens, because the sidebar
		that normally holds the list has become a drawer. Reading and answering a message
		is what a phone is actually good for, and it is the surface where a waiting one
		is easiest to lose.
	</p>
	<div class="mt-4 flex flex-wrap gap-6">
		<div>
			<div
				class="border-muted/15 bg-surface flex h-[30rem] w-[22rem] flex-col overflow-hidden rounded-lg border"
			>
				<div
					class="border-ink/5 flex h-11 shrink-0 items-center gap-2 border-b px-3"
				>
					<Menu size={16} class="text-muted" />
					<span class={UNREAD_COUNT}>{unreadCount(summary.count)}</span>
					<span class="font-display text-sm font-semibold">Messages</span>
				</div>
				{@render list()}
			</div>
			<p class="text-muted mt-2 text-[11px]">the list is the screen</p>
		</div>
		<div>
			<div
				class="border-muted/15 bg-surface flex h-[30rem] w-[22rem] flex-col overflow-hidden rounded-lg border"
			>
				{@render thread(true)}
			</div>
			<p class="text-muted mt-2 text-[11px]">
				a conversation, back to the list
			</p>
		</div>
		<div>
			<div
				class="border-muted/15 bg-surface flex h-[30rem] w-[22rem] flex-col overflow-hidden rounded-lg border"
			>
				<div
					class="border-ink/5 flex h-11 shrink-0 items-center gap-2 border-b px-3"
				>
					<Menu size={16} class="text-muted" />
					<span class="font-display text-sm font-semibold">Messages</span>
				</div>
				<div class="grid flex-1 place-items-center px-4">
					<EmptyState>
						Direct messages with your friends land here — a crew talks in its
						text channels.
						{#snippet cta()}
							<span class="btn btn-primary btn-xs">Message a friend</span>
						{/snippet}
					</EmptyState>
				</div>
			</div>
			<p class="text-muted mt-2 text-[11px]">
				nothing yet — the empty state teaches where the rest went
			</p>
		</div>
	</div>

	<h2 class="eyebrow mt-12">Still open — this page decides none of these</h2>
	<ol class="mt-4 space-y-3">
		{#each questions as question (question.q)}
			<li class="border-muted/15 bg-surface rounded-lg border p-4">
				<p class="text-sm font-medium">{question.q}</p>
				<p class="text-muted mt-1.5 text-xs">
					<span class="text-ink/80 font-medium">Today:</span>
					{question.today}
				</p>
				<p class="text-muted mt-1 text-xs">
					<span class="text-ink/80 font-medium">The other answer:</span>
					{question.other}
				</p>
				<p class="text-muted-dim mt-1 text-[11px]">{question.cost}</p>
			</li>
		{/each}
	</ol>
</main>
