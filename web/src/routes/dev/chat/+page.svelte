<script lang="ts" module>
	/** The decisions this page deliberately does not make. */
	const questions = [
		{
			q: 'A room gets a count, a DM gets a dot. One list, two grammars.',
			today:
				'a room is counted server-side (a read stamp per rider per room); a DM only knows "something is new", from a localStorage stamp the reader keeps.',
			other:
				'count DMs too, which means a server-side read position per conversation.',
			cost: 'A dot cannot be sorted by urgency, and two marks on one list ask the reader to learn two things. Counting DMs is a schema change (expand/contract) and makes "seen" a server fact, which ADR-0012 deliberately did not.',
		},
		{
			q: 'Standing in a room counts as reading its chat.',
			today:
				'a room you are in never shows a count, however long the chat runs while you watch Training; the Chat place carries missedSince instead, which is per-connection and dies with the page.',
			other:
				'"read" means the chat was actually on screen, so the room you are in is counted like any other.',
			cost: 'The honest version is also the noisy one: the room you are in is the room most likely to be talking. The cheap middle is what the sidebar does now — a count on the Chat place, not on the room.',
		},
		{
			q: "Is a room's chat a subscription of its own, or the room connection's log?",
			today:
				'two implementations of one thread. Inside: the socket. Outside: a 5 s poll and HTTP posts. RoomThread.svelte picks between them.',
			other:
				"one chat subscription, independent of the room connection — Discord's split, where a text channel is not the voice channel. Then being in the room would mean voice, the ride and the jukebox, nothing else.",
			cost: 'This one is a real architectural change and wants an ADR before any code: the hub owns live room state in memory, and a chat subscription that outlives the room connection changes who is in that map. Five seconds of latency on a message you are answering is also the thing riders actually feel.',
		},
		{
			q: 'Reading a thread marks the room read everywhere.',
			today:
				'one read stamp per rider per room, so opening a thread on your phone clears the badge on the laptop you are riding at.',
			other: 'a read position per device, or per session.',
			cost: 'Per-device read state is the kind of thing every messenger gets asked for and no messenger enjoys. Probably right as it is — listed so it stays a decision rather than an accident.',
		},
		{
			q: 'Nothing adds up what is waiting.',
			today:
				'per-room counts and per-DM dots in the sidebar, no total anywhere; below md the sidebar is a drawer, so the whole signal can be off screen.',
			other:
				'a total on the messages entry and on the drawer button — unreadSummary in this mock.',
			cost: 'A number on the way in is the first ask, and the cheapest thing here: a derived value over data the client already has. What it must not do is glow.',
		},
	];
</script>

<script lang="ts">
	// MOCK (#451) — the three states the rider report argues about, drawn on
	// the SHIPPED rules: orderThreads orders this list, unread-marks paints the
	// badges, missedSince counts what ran past your shoulder. Only the data is
	// fake. Where a question is still open the page shows both answers rather
	// than quietly picking one.
	import Avatar from '$lib/components/Avatar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import MessageText from '$lib/chat/MessageText.svelte';
	import Reactions from '$lib/chat/Reactions.svelte';
	import { stickToBottom } from '$lib/chat/stick-to-bottom';
	import { contextMenu, MENU_HINT } from '$lib/context-menu.svelte';
	import type { MenuEntry } from '$lib/context-menu.svelte';
	import { formatTime } from '$lib/format';
	import { STOCK_CHEERS } from '$lib/icons';
	import { mentionsMe } from '$lib/messages/mention';
	import { formatThreadWhen, orderThreads } from '$lib/messages/threads';
	import type { Thread } from '$lib/messages/threads';
	import {
		UNREAD_COUNT,
		UNREAD_DOT,
		unreadCount,
	} from '$lib/messages/unread-marks';
	import { missedSince } from '$lib/room/unread';
	import { toasts } from '$lib/toast.svelte';
	import {
		BellOff,
		CheckCheck,
		ChevronLeft,
		Headphones,
		Image as ImageIcon,
		LogOut,
		Menu,
		MessagesSquare,
		Radio,
		Search,
		UserRound,
	} from '@lucide/svelte';
	import {
		backlog,
		dmUnread,
		heads,
		HERE,
		hereChat,
		hereSeenAt,
		NOW,
		OUTSIDE,
		readAt,
		rooms,
		unreadSummary,
	} from './mock';

	const threads = orderThreads(rooms, heads, dmUnread);
	const summary = unreadSummary(threads);
	const openKey = `r:${OUTSIDE}`;
	const room = rooms.find((r) => r.slug === OUTSIDE)!;
	const here = rooms.find((r) => r.slug === HERE)!;
	const missed = missedSince(hereChat, hereSeenAt, 'jan');
	const places = ['Lounge', 'Training', 'Sessions', 'Chat'];

	const ME = 'Jan Lauber';
	const isNew = (m: { fromId?: string; at: number }) =>
		m.at > readAt && m.fromId !== 'jan';
	const newCount = backlog.filter(isNew).length;
	const firstNewId = backlog.find(isNew)?.id;

	// Nothing here changes anything — the menu proves the shape and says so.
	const nothing = (what: string) => () =>
		toasts.push(`${what} — mock, nothing happened`);

	function menuFor(t: Thread): MenuEntry[] {
		return [
			{ label: 'Mark as read', icon: CheckCheck, onSelect: nothing('Marked') },
			{ label: 'Mute', icon: BellOff, onSelect: nothing('Muted') },
			'separator',
			t.kind === 'room'
				? { label: 'Join the room', icon: Radio, onSelect: nothing('Joined') }
				: {
						label: 'Open the profile',
						icon: UserRound,
						onSelect: nothing('Opened'),
					},
			{
				label: t.kind === 'room' ? 'Leave the room' : 'Hide the conversation',
				icon: LogOut,
				danger: true,
				onSelect: nothing('Left'),
			},
		];
	}

	/** Which answer surface 3c is drawn for — the one thing on this page you can toggle. */
	let total = $state(true);
</script>

{#snippet row(t: Thread)}
	{@const on = t.key === openKey}
	<li>
		<a
			href="#thread"
			aria-current={on ? 'page' : undefined}
			title={MENU_HINT}
			{@attach contextMenu(() => menuFor(t))}
			class="flex items-center gap-2.5 rounded px-2 py-2 {on
				? 'bg-surface-raised'
				: 'hover:bg-surface-raised/60'}"
		>
			{#if t.kind === 'room'}
				<span
					class="bg-surface grid h-8 w-8 shrink-0 place-items-center rounded"
					><RoomIcon icon={t.icon} size={14} class="text-muted" /></span
				>
			{:else}
				<Avatar name={t.name} size={32} />
			{/if}
			<span class="min-w-0 flex-1">
				<span class="flex items-baseline gap-2">
					<span class="truncate text-sm {t.unread ? 'font-semibold' : ''}"
						>{t.name}</span
					>
					<span class="text-muted/60 ml-auto shrink-0 font-mono text-[10px]"
						>{formatThreadWhen(t.at, NOW)}</span
					>
				</span>
				<span class="flex items-center gap-1.5">
					<span
						class="min-w-0 flex-1 truncate text-xs {t.unread
							? 'text-ink/80'
							: 'text-muted'}">{t.preview || 'Nothing said here yet'}</span
					>
					{#if t.kind === 'room' && t.unread}
						<span class={UNREAD_COUNT}>{unreadCount(t.unread)}</span>
					{:else if t.unread}
						<span class={UNREAD_DOT} title="new since you last read it"></span>
					{/if}
				</span>
				{#if t.kind === 'room' && (t.here || t.voice)}
					<span
						class="text-muted/70 mt-0.5 flex items-center gap-1.5 text-[10px]"
					>
						{#if t.riding}<RidingBars size={8} />{/if}
						{t.here} here{#if t.voice}
							· <Headphones size={9} /> {t.voice}{/if}
					</span>
				{/if}
			</span>
		</a>
	</li>
{/snippet}

{#snippet list()}
	<div class="px-3 pt-3 pb-2">
		<span class="input input-xs flex items-center gap-2">
			<Search size={12} class="text-muted shrink-0" />
			<span class="text-muted/70 min-w-0 flex-1 truncate">Search messages</span>
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
		<span class="bg-surface grid h-7 w-7 shrink-0 place-items-center rounded"
			><RoomIcon icon={room.icon} size={14} class="text-muted" /></span
		>
		<span class="min-w-0">
			<span class="block truncate text-sm font-medium">{room.name}</span>
			<span class="text-muted flex items-center gap-1.5 truncate text-[11px]">
				<RidingBars size={8} />
				{room.connected} in the room · <Headphones size={10} />
				{room.voice?.length} in voice · you are reading from outside
			</span>
		</span>
		<span class="btn btn-accent btn-xs ml-auto shrink-0"
			><Radio size={13} /> Join the room</span
		>
	</header>
	<!-- The real log's own pinning, so a frame too short for the backlog opens
	     on the newest line the way the thread does. -->
	<div {@attach stickToBottom} class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
		<div class="space-y-2">
			{#each backlog as m (m.id)}
				{#if m.id === firstNewId}
					<div class="flex items-center gap-3 py-1" role="separator">
						<span class="bg-neon/60 h-px flex-1"></span>
						<span class="text-neon text-[10px] tracking-widest uppercase"
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
							<span class="text-muted/40 font-mono text-[10px]"
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
							cheers={STOCK_CHEERS}
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
			<span class="input text-muted/70 min-w-0 flex-1 truncate"
				>Message {room.name} — you are not in the room, they still see it</span
			>
			<span class="btn btn-primary">Send</span>
		</div>
		<p class="text-muted/70 mt-1.5 text-[10px]">
			Reactions and links work from here. Being in the room adds voice, the ride
			and queuing a link to the jukebox — not the words.
		</p>
	</div>
{/snippet}

<main class="mx-auto max-w-6xl px-6 py-12">
	<p class="eyebrow">mock · #451</p>
	<h1 class="font-display mt-2 text-3xl font-bold tracking-tight">
		Chat as a place
	</h1>
	<p class="text-muted mt-3 max-w-3xl text-sm">
		Jan's report: unread in rooms you are not in should be visible, and a room's
		chat should be readable without joining the room. Both shipped with Messages
		(#468, ADR-0020) — so this page is not a proposal for an empty space, it is
		the three states beside each other so what is left can be decided by
		looking. Every badge, every ordering and every “N new” line here is the real
		module over fake data, and each frame names the file that draws the real
		one.
	</p>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		1 · The messages place
	</h2>
	<p class="text-muted mt-2 max-w-3xl text-xs">
		Rooms and DMs in one list, ordered by <code>orderThreads</code>: unread
		first, then whoever spoke last, so a room is a thread like any other. The
		lunch crew is on top with seven waiting and nobody in it; the room you are
		standing in sits below them with none, because standing in a room counts as
		reading it. Right-click any row. Real:
		<code>lib/messages/ThreadList.svelte</code>.
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

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		2 · A thread with no room connection
	</h2>
	<p class="text-muted mt-2 max-w-3xl text-xs">
		The right-hand pane above, read closely. You are in the Sufferfest;
		Schwitzchaste is somewhere else entirely, and you can still read it, react
		to it and answer in it. The header says where you stand and offers the one
		thing a thread cannot give you. The “{newCount} new” rule and the mention bar
		take <code>--color-neon</code>: an unread mark is chrome, and ADR-0005 gives
		the glow to live data alone. Real:
		<code>lib/messages/RoomThread.svelte</code> over
		<code>lib/messages/outside.svelte.ts</code>.
	</p>
	<div class="mt-4 grid gap-3 md:grid-cols-2">
		<div class="border-muted/15 bg-surface rounded-lg border p-4">
			<p class="text-sm font-medium">What the thread does from outside</p>
			<ul class="text-muted mt-2 space-y-1 text-xs">
				<li>· reads the backlog, polled every 5 s — no socket, no voice</li>
				<li>· posts over HTTP; the hub hands it to whoever is inside</li>
				<li>· reactions, links and images all work</li>
				<li>· opening it marks the room read for you, on every device</li>
			</ul>
		</div>
		<div class="border-muted/15 bg-surface rounded-lg border p-4">
			<p class="text-sm font-medium">What being in the room adds</p>
			<ul class="text-muted mt-2 space-y-1 text-xs">
				<li>· the live log on the tick instead of a five-second poll</li>
				<li>· the room's own events between the lines (ADR-0022)</li>
				<li>· Queue on a YouTube card — the jukebox belongs to the socket</li>
				<li>· voice, the ride, the crew</li>
			</ul>
		</div>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		3 · The signal, seen from somewhere else
	</h2>
	<p class="text-muted mt-2 max-w-3xl text-xs">
		Three surfaces answer “something was said in a room you are not looking at”,
		and today they answer it differently.
	</p>
	<div class="mt-4 grid gap-3 lg:grid-cols-3">
		<div class="border-muted/15 bg-surface rounded-lg border p-3">
			<p class="text-muted text-[11px]">
				In the sidebar — a count per room, a dot per DM
			</p>
			<ul class="mt-2 space-y-0.5">
				{#each rooms as r (r.slug)}
					<li
						class="flex items-center gap-2 rounded px-2 py-1.5 {r.slug === HERE
							? 'text-ink'
							: 'text-muted/70'}"
					>
						{#if r.slug === HERE}
							<span
								class="bg-z4 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
								title="you are in this room"
							></span>
						{/if}
						<RoomIcon icon={r.icon} size={14} />
						<span
							class="truncate text-sm {r.slug === HERE
								? 'font-display text-base font-semibold'
								: r.unread
									? 'text-ink/80 font-medium'
									: ''}">{r.name}</span
						>
						{#if r.unread}
							<span class="{UNREAD_COUNT} ml-auto">{unreadCount(r.unread)}</span
							>
						{:else if r.connected}
							<span class="ml-auto flex shrink-0 items-center gap-1"
								><span class="bg-z4 h-1.5 w-1.5 rounded-full"></span><span
									class="text-muted/70 font-mono text-[10px]"
									>{r.connected}</span
								></span
							>
						{/if}
					</li>
				{/each}
			</ul>
		</div>

		<div class="border-muted/15 bg-surface rounded-lg border p-3">
			<p class="text-muted text-[11px]">
				Inside the room you are in — the count cannot help
			</p>
			<ul class="border-ink/10 mt-2 ml-3 space-y-0.5 border-l pl-2">
				{#each places as place (place)}
					<li
						class="flex items-center gap-2 rounded px-2 py-1.5 text-[13px] {place ===
						'Training'
							? 'bg-ink/5 text-ink'
							: 'text-muted'}"
					>
						<span class="truncate">{place}</span>
						{#if place === 'Training'}
							<span class="ml-auto"><RidingBars size={10} /></span>
						{:else if place === 'Chat' && missed}
							<span
								class="{UNREAD_COUNT} ml-auto"
								title="{missed.count} said while you were elsewhere"
								>{unreadCount(missed.count)}</span
							>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="text-muted/70 mt-2 text-[11px]">
				{here.name} carries no count anywhere else: you are standing in it, and that
				counts as reading. The Chat place answers with
				<code>missedSince</code> instead — {missed?.count} lines since you last had
				chat open, the last from {missed?.from} ({missed?.preview}).
			</p>
		</div>

		<div class="border-muted/15 bg-surface rounded-lg border p-3">
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
					<span class="text-muted text-xs"
						>the sidebar, as a drawer below md</span
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
			<p class="text-muted/70 mt-2 text-[11px]">
				Nothing sums anything up today. With the sidebar collapsed into its
				drawer, {summary.rooms} rooms and {summary.dms} DM are waiting behind a button
				that says nothing — which is Jan's first ask, on a phone.
				<code>unreadSummary</code> in this mock's fixtures is the proposal; it
				belongs beside <code>orderThreads</code> if we take it.
			</p>
		</div>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		4 · The same states on a phone
	</h2>
	<p class="text-muted mt-2 max-w-3xl text-xs">
		Below <code>md</code> the list and the thread are two screens, because the
		sidebar that normally holds the list has become a drawer. WATTROOM.md scopes
		a phone as a read-only spectator of a <em>ride</em> — reading and answering chat
		is what a phone is actually good for, and it is the surface where a room you are
		not in is easiest to lose.
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
				a room's chat, no room connection, back to the list
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
						Every room's chat and every note between friends lands here — and a
						room's chat reads and writes without joining it.
						{#snippet cta()}
							<span class="btn btn-primary btn-xs">Open a room</span>
						{/snippet}
					</EmptyState>
				</div>
			</div>
			<p class="text-muted mt-2 text-[11px]">
				nothing yet — the empty state teaches the second ask
			</p>
		</div>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Still open — this page decides none of these
	</h2>
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
				<p class="text-muted/70 mt-1 text-[11px]">{question.cost}</p>
			</li>
		{/each}
	</ol>
</main>
