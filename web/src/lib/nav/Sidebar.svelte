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
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { personMenu } from '$lib/person-menu';
	import { presence } from '$lib/presence.svelte';
	import { statusOf } from '$lib/status';
	import { goto } from '$app/navigation';
	import type { RailRoom } from '$lib/room/mockcompat';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Headphones from '@lucide/svelte/icons/headphones';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Plus from '@lucide/svelte/icons/plus';
	import { device } from '$lib/device.svelte';

	let {
		pathname,
		rooms = [],
		activeSlug = '',
		connectedSlug = '',
		live = false,
		onLeave,
		onMember,
	}: {
		pathname: string;
		rooms?: RailRoom[];
		activeSlug?: string;
		connectedSlug?: string;
		live?: boolean;
		onLeave?: () => void;
		/** A rider named in a room's people line — the layout resolves them. */
		onMember?: (slug: string, name: string) => void;
	} = $props();

	// Your own badge, on the same rule as everyone else's (#824): the people
	// column and the Members page show you riding; the rail said "online".

	const destination = $derived(activeHref(pathname));
	// Below md the drawer IS the room's index, and Settings is not offered
	// there (#412 — an owner-only form nobody fills in from a bike). One
	// answer, used by the list and by the room's context menu alike.
	const places = $derived(placesFor(device.narrow));
	const place = $derived(activeSlug ? activePlace(pathname, activeSlug) : '');
</script>

<nav
	class="bg-surface border-ink/5 flex h-full w-60 shrink-0 flex-col border-r"
>
	<a href="/home" class="flex items-center gap-2 px-4 py-4">
		<Logo size={22} {live} />
		<span class="font-display text-sm font-bold">WattRoom</span>
	</a>

	<div class="min-h-0 flex-1 overflow-y-auto px-2">
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

		<div class="eyebrow flex items-center px-2 pt-4 pb-1">
			your rooms
			<!-- Everything /rooms carried beyond the list: open one, or join with
			     a code (ADR-0020). -->
			<a
				href="/home#rooms"
				class="hover:text-ink -my-2 ml-auto grid h-11 w-11 place-items-center md:h-6 md:w-6"
				title="open a room or join with a code"
				aria-label="open a room or join with a code"><Plus size={16} /></a
			>
		</div>
		<ul class="space-y-0.5">
			{#each rooms as room (room.slug)}
				<!-- Connected and browsing-only are separate visual states. An active
				     room still opens into its places in either state. -->
				{@const reading = pathname === `/messages/r/${room.slug}`}
				{@const state = roomNavState(
					room.slug,
					activeSlug,
					connectedSlug,
					reading,
				)}
				{@const here = state === 'connected'}
				{@const browsing = state === 'browsing'}
				<!-- Opened: the room whose pages you are on, AND the one you are
					     standing in — reading a DM or Home while connected must not
					     fold Training two clicks away (rider report, #416). -->
				{@const open = room.slug === activeSlug || here}
				{@const subline = railSubline(room, open)}
				<!-- Two levels of the same wash, never one: the open room is a
				     faint ground, the row you're on a stronger fill on top of it.
				     Equal tints read as one slab and the selection disappears. -->
				<li
					class="rounded-md {here
						? 'bg-ink/5'
						: browsing
							? 'bg-ink/[0.03]'
							: ''}"
					{@attach contextMenu(() => {
						const entries: MenuEntry[] = places.map((place) => ({
							label: place.label,
							icon: place.icon,
							onSelect: () => void goto(`/r/${room.slug}${place.path}`),
						}));
						// The way in without going in (#484): the list lives here now,
						// so the way to a room's chat from outside lives here too.
						entries.push('separator', {
							label: 'Read the chat',
							icon: MessageSquare,
							hint: room.unread ? `${room.unread} new` : undefined,
							onSelect: () => void goto(`/messages/r/${room.slug}`),
						});
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
					<a
						href="/r/{room.slug}"
						class="block rounded px-2 pt-1.5 {subline === 'people'
							? 'pb-0'
							: 'pb-1.5'} {here
							? 'text-ink'
							: browsing
								? 'text-ink/90'
								: 'text-muted/70 hover:text-ink'}"
					>
						<span class="flex items-center gap-2">
							<RoomIcon icon={room.icon} size={14} />
							<span
								class="truncate {here
									? 'font-display text-ink text-base font-semibold'
									: browsing
										? 'font-display text-ink/90 text-[15px] font-medium'
										: room.unread
											? 'text-ink/80 text-sm font-medium'
											: 'text-muted/70 text-sm'}">{room.name}</span
							>
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
								     background window. -->
								<span
									class="{UNREAD_COUNT} ml-auto"
									title="{room.unread} new since you were last here"
									>{unreadCount(room.unread)}</span
								>
							{:else if (room.connected ?? 0) > 0}
								<span class="ml-auto flex shrink-0 items-center gap-1">
									<span class="bg-z4 h-1.5 w-1.5 rounded-full"></span>
									<span class="text-muted/70 font-mono text-[10px]"
										>{room.connected}</span
									>
								</span>
							{:else if room.members > 0}
								<span
									class="text-muted/50 ml-auto shrink-0 font-mono text-[10px]"
									>{room.members}</span
								>
							{/if}
						</span>
						{#if subline === 'session' && room.session}
							<!-- The late-join radar: what is on, and how far in. -->
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
					</a>

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
							{#if room.voice?.length}<Headphones
									size={9}
									class="shrink-0"
								/>{/if}
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
			{/each}
		</ul>

		<!-- Messages is a place (#468): every room's chat and every DM, one
		     list. The heading is the way in; the threads below open straight
		     into themselves. Rooms are already listed above, so they are not
		     repeated here — their unread count is the way in for them.
		     The heading names what is UNDER it rather than the place it opens
		     (#1017): these rows are threads with people, and a rider reading
		     "messages" over a column of faces could not tell them from the
		     friends list or from who is in the room with them. -->
		<div class="eyebrow flex items-center px-2 pt-4 pb-1">
			<a
				href="/messages"
				aria-current={pathname.startsWith('/messages') ? 'page' : undefined}
				class="hover:text-ink {pathname.startsWith('/messages')
					? 'text-ink'
					: ''}"
				title="every room's chat and your DMs, in one place">direct messages</a
			>
		</div>
		{#if dmHeads.heads.length > 0}
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
								preset={head.peerAvatarPreset}
								xp={head.peerTotalXp}
								status={statusOf(presence.rooms, head.peerId)}
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

	<YouPanel {pathname} />
</nav>
