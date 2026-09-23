<script lang="ts">
	// ADR-0020's one sidebar: a mode at the top — You, or one of your crews
	// (ADR-0058, #2447) — then that mode's pages (your own, or the crew's
	// pages and its text and voice channels), your messages, and you pinned
	// at the bottom. It replaced RoomRail, TopNav and MobileNav's destination
	// list — a destination has exactly one home.
	//
	// Names, not Discord's icon rail: icons exist because Discord has forty
	// servers, and ADR-0010 makes this strip the crew's radar — what is live,
	// who is in voice, what is planned. 48 px cannot say "Sweet Spot, 12 min in".
	import Avatar from '$lib/components/Avatar.svelte';
	import YouPanel from '$lib/nav/YouPanel.svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import VoiceStrip from './VoiceStrip.svelte';
	import CrewSwitcher from './CrewSwitcher.svelte';
	import CrewColumn from './CrewColumn.svelte';
	import { crewLive } from './crew-live.svelte';
	import { chosenCrew } from './chosen-crew.svelte';
	import JukeboxRail from '$lib/room/JukeboxRail.svelte';
	import { keepSize } from '$lib/pane';
	import { edgeDivider } from '$lib/divider';
	import { friends } from '$lib/friends/friends.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import {
		UNREAD_COUNT,
		UNREAD_DOT,
		unreadCount,
	} from '$lib/messages/unread-marks';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { activeHref, crewOfPath, dmsCurrent, pages } from './pages';
	import { readDmsFolded, rememberDmsFolded } from './folds';
	import { contextMenu, MENU_HINT } from '$lib/context-menu.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import StartOrJoin from '$lib/home/StartOrJoin.svelte';
	import { personMenu } from '$lib/person-menu';
	import { presence } from '$lib/presence.svelte';
	import { statusOf } from '$lib/status';
	import { goto } from '$app/navigation';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { device } from '$lib/device.svelte';
	import Monitor from '@lucide/svelte/icons/monitor';
	import UpdateRow from './UpdateRow.svelte';
	import { shellVersion } from '$lib/desktop';

	let {
		pathname,
		live = false,
	}: {
		pathname: string;
		live?: boolean;
	} = $props();

	// Your own badge, on the same rule as everyone else's (#824): the people
	// column and the Members page show you riding; the rail said "online".

	const destination = $derived(activeHref(pathname));
	// The mode follows where you stand (ADR-0020 rule 1, #2447): inside a
	// crew's pages the column is that crew; on one of your own pages it is
	// You, so the page always has its row; anywhere else it is the crew you
	// chose last. Choosing goes somewhere — the crew's Home, or yours —
	// because a mode the page then overrode would be a pick that did nothing.
	const crews = $derived(presence.crews);
	const crew = $derived.by(() => {
		const inCrew = crewOfPath(pathname);
		if (inCrew) return crews.find((c) => c.id === inCrew) ?? null;
		if (destination) return null;
		return crews.find((c) => c.id === chosenCrew.id) ?? null;
	});
	function pick(id: string) {
		chosenCrew.set(id);
		void goto(id === 'you' ? '/home' : `/crew/${id}`);
	}
	// What is happening in every crew, re-read on each lobby ping (#2444).
	$effect(() => {
		presence.version;
		void crewLive.reload();
	});
	// In no crew, the way in is a sheet: join with a code, or start one (#2480).
	let opening = $state(false);
	$effect(() => {
		pathname;
		opening = false;
	});
	// The direct-messages heading folds its list (#1359), remembered per
	// device. Folded, the heading carries the unread dot itself: a message
	// that arrived behind a fold is still announced (ux.md).
	let dmsFolded = $state(readDmsFolded());
	const dmsUnread = $derived(
		dmHeads.heads.some((head) => dmHeads.unread(head.peerId)),
	);
	function toggleDms() {
		dmsFolded = !dmsFolded;
		rememberDmsFolded(dmsFolded);
	}
	// The heading is the lit row for the pages under it whose own row is not
	// on screen to be lit (#1863) — see `dmsCurrent`. A shut fold draws no
	// rows, and a thread reached by its link before the list lands, or one
	// with no entry yet, has none to draw.
	const dmsOn = $derived(
		dmsCurrent(
			pathname,
			!dmsFolded &&
				dmHeads.heads.some(
					(head) => pathname === `/messages/dm/${head.peerId}`,
				),
		),
	);
</script>

<!-- Resizable from its right edge, the way the room's panel is from its
     left (#427), and remembered per device (keepSize). Only on a desk: below
     md this column is a drawer, and the width dragged on a desk is pinned
     back to the default there — a 400 px drawer on a 375 px phone leaves no
     backdrop to tap. -->
<nav
	aria-label="crews and channels"
	{@attach (node) => keepSize(node, 'sidebar')}
	class="bg-surface border-ink/5 relative flex h-full w-60 shrink-0 flex-col border-r max-md:w-60! md:max-w-[40vw] md:min-w-56"
>
	<div
		{@attach edgeDivider}
		class="hover:bg-neon/40 active:bg-neon/60 absolute inset-y-0 right-0 z-10 hidden w-1.5 cursor-col-resize touch-none transition-colors md:block"
		role="separator"
		aria-orientation="vertical"
		aria-label="resize the sidebar"
	></div>
	<!-- The crew is the header (ADR-0020 amended 2026-09-09, #1327): the
	     first row of the column names the place you are in, and the brand
	     leaves it — the tab, the title bar and the sign-in page carry that,
	     and riding is already on your avatar and on the Training row
	     (#1016), so the mark had no job left here. Before the first room
	     there is no crew to name, so the mark and the wordmark keep the row. -->
	{#if crews.length > 0}
		<CrewSwitcher {crews} {crew} onpick={pick} />
	{:else}
		<!-- The wordmark is day zero AND "not read yet" (#2173). Saying so is
		     the difference between a rider with no crew and a rider whose
		     first read is still out; the switcher takes the row the moment one
		     lands, so this is a skeleton's width and nothing more. -->
		<a href="/home" class="flex items-center gap-2 px-4 py-4">
			<Logo size={22} {live} />
			{#if presence.loaded}
				<span class="font-display text-sm font-bold">WattRoom</span>
			{:else}
				<Skeleton class="h-4 w-24" />
			{/if}
		</a>
	{/if}
	<div class="min-h-0 flex-1 overflow-y-auto px-2 pt-3">
		<!-- Above Home, because a downloaded update is the one thing here that
		     expires: it is what the app will be running next time either way,
		     and the only choice is whether the rider picks the moment. Nothing
		     renders unless one is waiting. -->
		<UpdateRow />
		{#if crew}
			<!-- A crew's pages, its text channels, its voice channels (#2447). -->
			<CrewColumn {crew} {pathname} />
		{:else}
			<ul class="space-y-0.5">
				{#each pages as entry (entry.href)}
					{@const on = destination === entry.href}
					<!-- The one announceable thing with no home in the sidebar (#1010):
					     a friend request announced itself once and then left no
					     trace. It counted people waiting on you from a word in the
					     messages eyebrow; now that Friends is a row, it counts them
					     there (#1017). Visiting the page does not clear it —
					     answering them does. -->
					{@const waiting = entry.href === '/friends' ? friends.waiting : 0}
					<li>
						<a
							href={entry.href}
							aria-current={on ? 'page' : undefined}
							title={waiting > 0
								? `${waiting} waiting for you to answer`
								: undefined}
							class="flex min-h-11 items-center gap-2 rounded px-2 py-1.5 text-sm md:min-h-0 {on
								? 'bg-ink/10 text-ink'
								: 'text-muted hover:bg-ink/5 hover:text-ink'}"
						>
							<entry.icon size={15} class="shrink-0" />
							{entry.label}
							{#if waiting > 0}
								<span class="{UNREAD_COUNT} ml-auto"
									>{unreadCount(waiting)}</span
								>
							{/if}
						</a>
					</li>
				{/each}
			</ul>

			<!-- A failed read is not an empty one (#2173): both leave no crews,
			     and only one of them is a rider to teach. -->
			{#if presence.error && crews.length === 0}
				<p class="text-muted px-2 pt-3 text-xs">
					{presence.error}
					<button onclick={() => presence.reload()} class="btn-link"
						>Retry</button
					>
				</p>
			{:else if presence.loaded && crews.length === 0}
				<!-- In no crew at all (#2144): the way in is joining one, and
				     starting a crew of your own is the option, not the ask. -->
				<p class="text-muted px-2 pt-3 text-xs">
					Not in a crew yet —
					<button onclick={() => (opening = true)} class="btn-link"
						>join one with its code</button
					>, or start one of your own.
				</p>
			{/if}
		{/if}

		<!-- Messages is a place (#468): every room's chat and every DM, one
		     list, and on a desk the sidebar IS that list (#484). Rooms are
		     already listed above, so they are not repeated here — their
		     unread count is the way in for them. The heading names what is
		     UNDER it rather than a place (#1017): these rows are threads with
		     people, and a rider reading "messages" over a column of faces
		     could not tell them from the friends list or from who is in the
		     room with them. -->
		<div class="eyebrow flex items-center px-2 pt-4 pb-1">
			<!-- The heading folds the list (#1359): a chevron at the end of a
			     section heading says fold, not go — the crew switcher above
			     taught that. A button resets text-transform, so the eyebrow's
			     uppercase is said again here. /messages itself is reached below
			     md, where the drawer's thread list stands in for this column. -->
			<!-- Lit while you are on a page under it whose own row cannot say so
			     (#1863): the same fill and ink every current row in this column
			     wears, so "where am I" has one answer everywhere. Chrome, so
			     `--color-ink` — never watt, never a glow (ADR-0005). The padding
			     against equal negative margins does two jobs and moves the
			     label by nothing: it puts the fill in the destination rows' own
			     box, and it takes the fold off a 15 px target, under ux.md's
			     24 px floor (WCAG 2.2 SC 2.5.8), up to 27. -->
			<button
				onclick={toggleDms}
				aria-expanded={!dmsFolded}
				aria-current={dmsOn ? 'page' : undefined}
				class="-mx-2 -my-1.5 flex w-full items-center rounded px-2 py-1.5 text-left uppercase {dmsOn
					? 'bg-ink/10 text-ink'
					: 'hover:text-ink'}"
				title={dmsFolded
					? 'show your conversations'
					: 'hide your conversations'}
				>direct messages{#if dmsFolded && dmsUnread}<span
						class="{UNREAD_DOT} ml-2"
						title="someone wrote"
					></span>{/if}<ChevronRight
					size={14}
					class="-my-2 ml-auto shrink-0 transition-transform motion-reduce:transition-none {dmsFolded
						? ''
						: 'rotate-90'}"
				/></button
			>
		</div>
		{#if dmHeads.loaded && dmHeads.heads.length === 0 && !dmsFolded}
			<!-- A heading over nothing taught nothing (#1819): the first thread
			     starts on a friend's page. -->
			<a
				href="/friends"
				class="text-muted hover:text-ink mx-2 mb-2 block rounded px-2 py-1 text-xs"
				>Message a friend to start one</a
			>
		{:else if dmHeads.heads.length > 0 && !dmsFolded}
			<ul class="pb-2">
				{#each dmHeads.heads as head (head.peerId)}
					{@const on = pathname === `/messages/dm/${head.peerId}`}
					<li
						title={MENU_HINT}
						{@attach contextMenu(() =>
							// DMs are friends-only (ADR-0012), so a head here is a
							// friend or an ex-friend (#1814) — the menu offered
							// "Add friend" to both, and the server refuses it for
							// the first (#2169). The list this row already reads
							// for its presence dot answers which.
							personMenu(head.peerId, goto, {
								conversation: true,
								friendship: friends.list?.find((f) => f.id === head.peerId)
									?.status,
							}),
						)}
					>
						<a
							href="/messages/dm/{head.peerId}"
							aria-current={on ? 'page' : undefined}
							class="flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm md:min-h-0 {on
								? 'bg-ink/10 text-ink'
								: dmHeads.unread(head.peerId)
									? 'text-ink font-semibold'
									: 'text-muted hover:bg-ink/5 hover:text-ink'}"
						>
							<Avatar
								name={head.peerName}
								avatarUrl={head.peerAvatarUrl}
								xp={head.peerTotalXp}
								status={statusOf(crewLive.crews, head.peerId, friends.list)}
								size={20}
							/>
							<span class="truncate">{head.peerName}</span>
							{#if dmHeads.unread(head.peerId)}
								<span class="{UNREAD_DOT} ml-auto"></span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- The video, wherever the people column is not (#427): below xl the room
	     has no column, and off the room pages there is none at all. -->
	{#if roomConnection.current}
		<JukeboxRail />
	{/if}

	<!-- Who is in the room with you, while you are looking elsewhere (#446).
	     Above you, like Discord's voice panel; off the Lounge, which already
	     shows everyone in tiles. -->
	{#if roomConnection.current}
		<VoiceStrip {pathname} />
	{/if}

	<!-- Discord's "download apps" corner (#1235): a quiet, permanent way to
	     the desktop app, for a rider in a browser on a desk. Gone inside the
	     shell, and on a phone, where the app is not for them. -->
	{#if !shellVersion() && !device.coarse}
		<a
			href="/download"
			class="text-muted hover:text-ink border-ink/5 flex items-center gap-2 border-t px-4 py-2.5 text-xs"
		>
			<Monitor size={14} />
			Get the desktop app
		</a>
	{/if}

	<YouPanel {pathname} />
</nav>

{#if opening}
	<Modal
		label="Start or join a crew"
		onclose={() => (opening = false)}
		class="max-w-sm"
	>
		<StartOrJoin compact />
	</Modal>
{/if}
