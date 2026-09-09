<script lang="ts">
	// ADR-0020's one sidebar: your places, your rooms with the one you are
	// standing in opened into ITS places, your messages, and you pinned at the
	// bottom. It replaces RoomRail, TopNav and MobileNav's destination list —
	// a destination now has exactly one home.
	//
	// Names, not Discord's icon rail: icons exist because Discord has forty
	// servers, and ADR-0010 makes this strip the crew's radar — what is live,
	// who is in voice, what is planned. 48 px cannot say "Sweet Spot, 12 min in".
	import Avatar from '$lib/components/Avatar.svelte';
	import YouPanel from '$lib/nav/YouPanel.svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import RoomStrip from './RoomStrip.svelte';
	import CrewSwitcher from './CrewSwitcher.svelte';
	import { chosenCrew } from './chosen-crew.svelte';
	import JukeboxRail from '$lib/room/JukeboxRail.svelte';
	import { friends } from '$lib/friends/friends.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import { formatWhen } from '$lib/format';
	import {
		UNREAD_COUNT,
		UNREAD_DOT,
		unreadCount,
	} from '$lib/messages/unread-marks';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { activeHref, activePlace, pages, placesFor } from './pages';
	import { railPeople, railPeopleMenu, railSubline } from './rail-people';
	import { roomNavState } from './room-state';
	import {
		accessMark,
		crewsOf,
		currentCrew,
		reachable,
		sidebarGroups,
	} from './crews';
	import { readDmsFolded, rememberDmsFolded } from './folds';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import OpenOrJoin from '$lib/rooms/OpenOrJoin.svelte';
	import { personMenu } from '$lib/person-menu';
	import { presence } from '$lib/presence.svelte';
	import { statusOf } from '$lib/status';
	import { goto } from '$app/navigation';
	import type { RailRoom } from '$lib/room/mockcompat';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Headphones from '@lucide/svelte/icons/headphones';
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Plus from '@lucide/svelte/icons/plus';
	import { device } from '$lib/device.svelte';
	import Monitor from '@lucide/svelte/icons/monitor';
	import { shellVersion } from '$lib/desktop';

	let {
		pathname,
		rooms = [],
		activeSlug = '',
		connectedSlug = '',
		live = false,
		onLeave,
		onMember,
		onSheet,
	}: {
		pathname: string;
		rooms?: RailRoom[];
		activeSlug?: string;
		connectedSlug?: string;
		live?: boolean;
		onLeave?: () => void;
		/** A rider named in a room's people line — the layout resolves them. */
		onMember?: (slug: string, name: string) => void;
		/**
		 * The sidebar is opening a sheet of its own (#1199). Below md the
		 * layout's drawer sits above dialogs (z-50 over z-40, and dialogs stay
		 * there for the player's sake), so the drawer has to step aside the
		 * way it does on navigation.
		 */
		onSheet?: () => void;
	} = $props();

	// Your own badge, on the same rule as everyone else's (#824): the people
	// column and the Members page show you riding; the rail said "online".

	const destination = $derived(activeHref(pathname));
	// Below md the drawer IS the room's index, and Settings is not offered
	// there (#412 — an owner-only form nobody fills in from a bike). One
	// answer, used by the list and by the room's context menu alike.
	const places = $derived(placesFor(device.narrow));
	const place = $derived(activeSlug ? activePlace(pathname, activeSlug) : '');

	// The crew is a mode the sidebar is in (ADR-0020 amended, #1147): one
	// crew's rooms at a time, chosen here and remembered, with the room you
	// are standing in pinned above the list when it belongs to another crew.
	const crews = $derived(crewsOf(rooms, presence.crews));
	const crew = $derived(
		currentCrew(crews, chosenCrew.id, rooms, connectedSlug),
	);
	const groups = $derived(sidebarGroups(rooms, crew, connectedSlug));
	function pick(id: string) {
		chosenCrew.set(id);
	}
	// The + beside rooms opens the open/join forms in a sheet (#1199).
	let opening = $state(false);
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
</script>

<!-- A crew's mark: its icon, or its initial in the same box. -->

{#snippet roomRow(room: RailRoom)}
	<!-- Connected and browsing-only are separate visual states. An active
		     room still opens into its places in either state. -->
	{@const reading = pathname === `/messages/r/${room.slug}`}
	{@const state = roomNavState(room.slug, activeSlug, connectedSlug, reading)}
	{@const here = state === 'connected'}
	{@const browsing = state === 'browsing'}
	<!-- Opened: the room whose pages you are on, AND the one you are
			     standing in — reading a DM or Home while connected must not
			     fold Training two clicks away (rider report, #416). -->
	<!-- ...but a crew room you have not joined has no places of yours to
	     open into: the page it shows is the door, not the room (#1149). -->
	{@const open = (room.slug === activeSlug && !!room.role) || here}
	{@const subline = railSubline(room, open)}
	<!-- A room you cannot enter is not a link that fails (#1149, ux.md):
		     the row stays, says why, and goes nowhere. The mark is chrome,
		     not live data: muted, never watt, never a glow (ADR-0005). -->
	{@const open_ = reachable(room.access)}
	{@const mark = accessMark(room.access)}
	<!-- Two levels of the same wash, never one: the open room is a
		     faint ground, the row you're on a stronger fill on top of it.
		     Equal tints read as one slab and the selection disappears. -->
	<li
		class="rounded-md {here ? 'bg-ink/5' : browsing ? 'bg-ink/[0.03]' : ''}"
		{@attach contextMenu(() => {
			if (!open_) return [];
			// A room open to the crew that you have not walked into yet (#1236)
			// has no places of yours and no chat you may read: its one action
			// is the door, and a menu that offered the rest would 403 on click
			// (ux.md: never render a button that will fail).
			if (!room.role)
				return [
					{
						label: 'Walk in',
						icon: DoorOpen,
						onSelect: () => void goto(`/r/${room.slug}`),
					},
				];
			const entries: MenuEntry[] = places.map((place) => ({
				label: place.label,
				icon: place.icon,
				onSelect: () => void goto(`/r/${room.slug}${place.path}`),
			}));
			if (here && onLeave)
				entries.push('separator', {
					label: 'Leave the room',
					icon: LogOut,
					onSelect: onLeave,
					danger: true,
				});
			return entries;
		})}
	>
		<svelte:element
			this={open_ ? 'a' : 'div'}
			href={open_
				? room.session && !here
					? `/r/${room.slug}/training`
					: `/r/${room.slug}`
				: undefined}
			title={open_ ? undefined : mark?.label}
			class="block rounded px-2 pt-1.5 {subline === 'people'
				? 'pb-0'
				: 'pb-1.5'} {here
				? 'text-ink'
				: browsing
					? 'text-ink/90'
					: open_
						? 'text-muted/70 hover:text-ink'
						: 'text-muted/45'}"
		>
			<span class="flex items-center gap-2">
				<RoomIcon icon={room.icon} size={14} />
				<span
					class="truncate {here
						? 'text-ink text-sm font-semibold'
						: browsing
							? 'text-ink/90 text-sm font-medium'
							: room.unread
								? 'text-ink/80 text-sm font-medium'
								: open_
									? 'text-muted/70 text-sm'
									: 'text-muted/45 text-sm'}">{room.name}</span
				>
				{#if mark}
					<mark.icon
						size={11}
						class="text-muted/60 shrink-0"
						aria-label={mark.label}
					/>
				{/if}
				{#if here && onLeave}
					<button
						onclick={(e) => {
							e.preventDefault();
							onLeave();
						}}
						class="text-muted hover:text-ink -my-2 ml-auto grid h-11 w-11 shrink-0 place-items-center md:h-6 md:w-6"
						title="leave the room"
						aria-label="leave the room"><LogOut size={16} /></button
					>
				{:else if room.unread}
					<!-- The strongest reason a chat app stays open in a
					     background window — and the door to reading it without
					     walking in (#1328, #484): the count opens the room's chat
					     from outside, the way the icon above leaves the room, and
					     stops the row's own click. Nothing unread, no door: then
					     the way to a room's chat is walking in. -->
					<button
						onclick={(e) => {
							e.preventDefault();
							void goto(`/messages/r/${room.slug}`);
						}}
						class="-my-2 ml-auto grid h-11 min-w-11 shrink-0 place-items-center md:h-6 md:min-w-6"
						title="{room.unread} new · read without walking in"
						aria-label="{room.unread} new — read the chat without walking in"
						><span class={UNREAD_COUNT}>{unreadCount(room.unread)}</span
						></button
					>
				{:else if (room.connected ?? 0) > 0}
					<span class="ml-auto flex shrink-0 items-center gap-1">
						<span class="bg-z4 h-1.5 w-1.5 rounded-full"></span>
						<span class="text-muted/70 font-mono text-[10px]"
							>{room.connected}</span
						>
					</span>
				{:else if room.members > 0}
					<span class="text-muted/50 ml-auto shrink-0 font-mono text-[10px]"
						>{room.members}</span
					>
				{/if}
			</span>
			{#if subline === 'session' && room.session}
				<!-- The late-join radar: what is on, and how far in — and the row
				     it sits in lands on Training while it runs (#1332), where the
				     numbers are, unless you are already standing in the room. -->
				<span
					class="text-watt/90 mt-0.5 flex items-center gap-1.5 truncate text-[10px]"
				>
					<RidingBars size={9} />
					{room.session.workoutName} · {room.session.elapsedSec < 60
						? 'starting'
						: `${Math.round(room.session.elapsedSec / 60)} min in`}
				</span>
			{:else if subline === 'next' && room.next}
				<span class="text-muted/70 mt-0.5 block truncate text-[10px]"
					>next: {room.next.workoutName} · {formatWhen(
						room.next.startsAt,
					)}</span
				>
			{/if}
		</svelte:element>

		{#if subline === 'people'}
			{@const people = railPeople(room.riders)}
			<!-- Who is in there, without going in (#438): Discord lists the
				     people under a voice channel. It sits OUTSIDE the room's
				     link — a target of its own, the rail's full width, opening
				     the roster where each of them has a row (#540). The names
				     it printed are one right-click away, individually; three
				     buttons inside a 10 px line would be precision targets on
				     a bike (ux.md). -->
			<a
				href="/r/{room.slug}/members"
				title="who is here · {MENU_HINT}"
				class="text-muted/80 hover:bg-ink/5 hover:text-ink flex items-center gap-1 rounded px-2 pt-1 pb-1.5 text-[10px]"
				{@attach contextMenu(() =>
					railPeopleMenu(
						room.riders,
						onMember && ((name) => onMember(room.slug, name)),
						() => void goto(`/r/${room.slug}/members`),
					),
				)}
			>
				{#if room.voice?.length}<Headphones size={9} class="shrink-0" />{/if}
				<span class="truncate">{people.label}</span>
			</a>
		{/if}

		{#if open}
			<!-- What was said while you were in another place (#568): the
				     room's own unread cannot say it — standing in the room
				     reads it — so this is the connection's answer, the same one
				     the people column's bar shows. -->
			{@const missed =
				roomConnection.current?.slug === room.slug
					? roomConnection.current.missed()
					: null}
			<!-- The room you are standing in opens. This is Discord's
				     second column, and it costs one indent instead of one
				     column (ADR-0020). -->
			<ul class="mt-0.5 mr-2 mb-1 ml-4 space-y-0.5 pb-1.5">
				{#each places as entry (entry.path)}
					{@const on = room.slug === activeSlug && place === entry.path}
					<li>
						<a
							href="/r/{room.slug}{entry.path}"
							aria-current={on ? 'page' : undefined}
							class="flex min-h-11 items-center gap-2 rounded px-2 py-1.5 text-[13px] md:min-h-0 {on
								? 'bg-ink/10 text-ink'
								: 'text-muted hover:bg-ink/5 hover:text-ink'}"
						>
							<entry.icon size={14} class="shrink-0" />
							<span class="truncate">{entry.label}</span>
							{#if entry.path === '/training' && live}
								<span class="ml-auto"><RidingBars size={10} /></span>
							{:else if entry.path === '/chat' && missed}
								<span
									class="{UNREAD_COUNT} ml-auto"
									title="{missed.count} said while you were elsewhere"
									>{unreadCount(missed.count)}</span
								>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<nav
	class="bg-surface border-ink/5 flex h-full w-60 shrink-0 flex-col border-r"
>
	<!-- The crew is the header (ADR-0020 amended 2026-09-09, #1327): the
	     first row of the column names the place you are in, and the brand
	     leaves it — the tab, the title bar and the sign-in page carry that,
	     and riding is already on your avatar and on the Training row
	     (#1016), so the mark had no job left here. Before the first room
	     there is no crew to name, so the mark and the wordmark keep the row. -->
	{#if crew}
		<CrewSwitcher {crews} {crew} {rooms} onpick={pick} />
	{:else}
		<a href="/home" class="flex items-center gap-2 px-4 py-4">
			<Logo size={22} {live} />
			<span class="font-display text-sm font-bold">WattRoom</span>
		</a>
	{/if}
	<div class="min-h-0 flex-1 overflow-y-auto px-2 pt-3">
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
							<span class="{UNREAD_COUNT} ml-auto">{unreadCount(waiting)}</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>

		{#if groups.pinned}
			<!-- The room you are standing in, whichever crew is on screen: reading
			     another crew must not fold Training two clicks away (#416). -->
			<div class="eyebrow px-2 pt-3 pb-1">
				you are in · {groups.pinned.crew?.name}
			</div>
			<ul class="border-ink/5 mb-1 space-y-0.5 border-b pb-2">
				{@render roomRow(groups.pinned)}
			</ul>
		{/if}

		<div class="eyebrow flex items-center px-2 pt-4 pb-1">
			<!-- Just "rooms": the header above already names the crew they
			     belong to (#1327). -->
			rooms
			<!-- Everything /rooms carried beyond the list: open one, or join with
			     a code (ADR-0020). -->
			<!-- Opens the forms right here (#1199) — Discord's "+ Create
			     Channel" in the server you are looking at, not a trip to the
			     bottom of Home. -->
			<button
				onclick={() => {
					opening = true;
					onSheet?.();
				}}
				class="hover:text-ink -my-2 ml-auto grid h-11 w-11 place-items-center md:h-6 md:w-6"
				title="open a room or join a crew with a code"
				aria-label="open a room or join a crew with a code"
				><Plus size={16} /></button
			>
		</div>
		<ul class="space-y-0.5">
			{#each groups.rooms as room (room.slug)}
				{@render roomRow(room)}
			{/each}
		</ul>

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
			<button
				onclick={toggleDms}
				aria-expanded={!dmsFolded}
				class="hover:text-ink flex w-full items-center text-left uppercase"
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
		{#if dmHeads.heads.length > 0 && !dmsFolded}
			<ul class="pb-2">
				{#each dmHeads.heads as head (head.peerId)}
					{@const on = pathname === `/messages/dm/${head.peerId}`}
					<li
						title={MENU_HINT}
						{@attach contextMenu(() =>
							personMenu(head.peerId, goto, { conversation: true }),
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
								status={statusOf(presence.rooms, head.peerId, friends.list)}
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
	{#if connectedSlug}
		<JukeboxRail />
	{/if}

	<!-- Who is in the room with you, while you are looking elsewhere (#446).
	     Above you, like Discord's voice panel; off the Lounge, which already
	     shows everyone in tiles. -->
	{#if connectedSlug}
		<RoomStrip {pathname} />
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
	<Modal label="Open a room" onclose={() => (opening = false)} class="max-w-sm">
		<!-- The crew on screen (#1201): the room lands there when you may open
		     rooms in it, else in your own — the form says which. -->
		<OpenOrJoin compact crewId={crew?.id} />
	</Modal>
{/if}
