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
	import { account } from '$lib/account.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { inviteLink } from '$lib/crew';
	import { leaveCrewFlow } from '$lib/crew-flows';
	import { activeHref, activePlace, pages, placesFor } from './pages';
	import { railPeople, railPeopleMenu, railSubline } from './rail-people';
	import { roomNavState } from './room-state';
	import {
		accessMark,
		crewPulse,
		crewsOf,
		quiet,
		currentCrew,
		dismissIntro,
		introDismissed,
		reachable,
		readChosenCrew,
		rememberChosenCrew,
		sidebarGroups,
	} from './crews';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import CrewMark from '$lib/components/CrewMark.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import OpenOrJoin from '$lib/rooms/OpenOrJoin.svelte';
	import { personMenu } from '$lib/person-menu';
	import { presence } from '$lib/presence.svelte';
	import { statusOf } from '$lib/status';
	import { goto } from '$app/navigation';
	import type { RailRoom } from '$lib/room/mockcompat';
	import type { RoomCrew } from '$lib/room/room-data';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Headphones from '@lucide/svelte/icons/headphones';
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import Link from '@lucide/svelte/icons/link';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Settings from '@lucide/svelte/icons/settings';
	import Plus from '@lucide/svelte/icons/plus';
	import Check from '@lucide/svelte/icons/check';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import Shield from '@lucide/svelte/icons/shield';
	import Users from '@lucide/svelte/icons/users';
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
	let chosen = $state(readChosenCrew());
	const crews = $derived(crewsOf(rooms));
	const crew = $derived(currentCrew(crews, chosen, rooms, connectedSlug));
	const groups = $derived(sidebarGroups(rooms, crew, connectedSlug));
	// What the header says under the name: how many rooms, and what you are
	// to it. Owner is a word here because the shield alone is a small mark;
	// member says nothing, being in it at all is the default.
	// The one number that tells two crews apart at a glance (#1238): the
	// role words went — the header's mark says "yours", and the crew page
	// says the rest.
	function crewLine(c: RoomCrew): string {
		const n = rooms.filter((r) => r.crew?.id === c.id).length;
		return n === 1 ? '1 room' : `${n} rooms`;
	}
	function pick(id: string) {
		chosen = id;
		rememberChosenCrew(id);
	}
	// The crew's menu (#1257, ux.md): everything about the crew that is a
	// page or two away, from the row that names it. The click stays the
	// primary action; nothing here lives only in the menu.
	function crewEntries(c: RoomCrew): MenuEntry[] {
		const owned = rooms.filter(
			(r) => r.crew?.id === c.id && r.role === 'owner',
		);
		const entries: MenuEntry[] = [
			{
				label: 'People and rooms',
				icon: Users,
				onSelect: () => void goto(`/crew/${c.id}`),
			},
		];
		if (c.role === 'owner' || c.role === 'admin')
			entries.push({
				label: 'Settings',
				icon: Settings,
				onSelect: () => void goto(`/crew/${c.id}/settings`),
			});
		if (c.code) {
			const code = c.code;
			entries.push({
				label: 'Copy invite link',
				icon: Link,
				onSelect: () =>
					void navigator.clipboard
						.writeText(inviteLink(code))
						.then(() => toasts.push('Invite link copied.')),
			});
		}
		if (c.role !== 'owner')
			entries.push('separator', {
				label: 'Leave the crew',
				icon: LogOut,
				danger: true,
				disabled: owned.length > 0,
				hint: owned.length ? 'you own a room here' : undefined,
				onSelect: () => void leaveCrewFlow(c),
			});
		return entries;
	}
	// The + beside rooms opens the open/join forms in a sheet (#1199).
	let opening = $state(false);
	// The dropdown under the header: the sidebar's full width, like Discord's
	// server menu, never a popup at the pointer. Closes on a click anywhere
	// else, on Escape, and on choosing.
	let switching = $state(false);
	let header = $state<HTMLElement | null>(null);
	$effect(() => {
		if (!switching) return;
		const away = (e: PointerEvent) => {
			if (!header?.contains(e.target as Node)) switching = false;
		};
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') switching = false;
		};
		document.addEventListener('pointerdown', away);
		document.addEventListener('keydown', key);
		return () => {
			document.removeEventListener('pointerdown', away);
			document.removeEventListener('keydown', key);
		};
	});
	// The day the crew arrives (#1151), said once and briefly: while the crew
	// you own still carries the placeholder name it was made with, a toast
	// names it and points at the settings page where the name is edited
	// (#1237). Not a card in the sidebar — that spent forty pixels on a
	// sentence — and it makes no claim about visibility, because none changed.
	$effect(() => {
		const own = crew;
		if (!own || own.role !== 'owner' || introDismissed(own.id)) return;
		if (own.name !== account.me?.displayName) return;
		dismissIntro(own.id);
		toasts.push(
			`Your crew is named “${own.name}” after you until you rename it — in its settings.`,
			{ href: `/crew/${own.id}/settings`, seconds: 8 },
		);
	});
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
		<svelte:element
			this={open_ ? 'a' : 'div'}
			href={open_ ? `/r/${room.slug}` : undefined}
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
						? 'font-display text-ink text-base font-semibold'
						: browsing
							? 'font-display text-ink/90 text-[15px] font-medium'
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
					<span class="text-muted/50 ml-auto shrink-0 font-mono text-[10px]"
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
	<a href="/home" class="flex items-center gap-2 px-4 py-4">
		<Logo size={22} {live} />
		<span class="font-display text-sm font-bold">WattRoom</span>
	</a>

	{#if crew}
		<!-- The crew is the mode the whole column is in (ADR-0020 amended,
		     #1147), so it sits at the top like Discord's server header — drawn
		     as one more nav row, not a boxed card (#1238): the same 16 px left
		     edge, the same icon slot and label as Home below it. Opening it
		     expands the crews in place, plain rows at the same indentation;
		     nothing floats, nothing is rounded, nothing is inset. -->
		<div class="px-2" bind:this={header}>
			{#snippet crewRow(c: RoomCrew)}
				<CrewMark name={c.name} icon={c.icon} imageUrl={c.imageUrl} size={20} />
				<span class="font-display min-w-0 flex-1 truncate text-sm font-bold"
					>{c.name}</span
				>
				{#if c.role === 'owner'}
					<Shield size={12} class="text-muted/60 shrink-0" aria-label="yours" />
				{/if}
			{/snippet}
			{#if crews.length > 1}
				<button
					onclick={() => (switching = !switching)}
					{@attach contextMenu(() => crewEntries(crew!))}
					class="hover:bg-ink/5 flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left md:min-h-0 {switching
						? 'bg-ink/5 text-ink'
						: 'text-ink'}"
					title="switch crew"
					aria-label="crew: {crew.name} — switch crew"
					aria-expanded={switching}
				>
					{@render crewRow(crew)}
					<ChevronsUpDown size={14} class="text-muted shrink-0" />
				</button>
			{:else}
				<!-- One crew: nothing to switch, so the row is the crew's page
				     (the 95% rule, ux.md) and spends no chevron on a choice that
				     does not exist. -->
				<a
					href="/crew/{crew.id}"
					{@attach contextMenu(() => crewEntries(crew!))}
					class="hover:bg-ink/5 text-ink flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 md:min-h-0"
					title="the crew — its people and rooms"
				>
					{@render crewRow(crew)}
				</a>
			{/if}
			{#if switching}
				{@const here = crew}
				<ul class="mt-0.5 space-y-0.5" role="menu">
					{#each crews as c (c.id)}
						{@const now = c.id === here.id}
						<li>
							<button
								role="menuitem"
								onclick={() => {
									pick(c.id);
									switching = false;
								}}
								{@attach contextMenu(() => crewEntries(c))}
								class="flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm md:min-h-0 {now
									? 'bg-ink/10 text-ink'
									: 'text-muted hover:bg-ink/5 hover:text-ink'}"
								aria-current={now ? 'true' : undefined}
							>
								<CrewMark
									name={c.name}
									icon={c.icon}
									imageUrl={c.imageUrl}
									size={20}
								/>
								<span class="min-w-0 flex-1 truncate">{c.name}</span>
								<span class="text-muted shrink-0 text-[11px]"
									>{crewLine(c)}</span
								>
								{#if now}<Check size={13} class="text-muted shrink-0" />{/if}
							</button>
						</li>
					{/each}
					<!-- The crew's own page: its people, its rooms, its name
					     (#1150, #1151) — one more row, not a boxed footer. -->
					<li>
						<a
							href="/crew/{here.id}"
							role="menuitem"
							onclick={() => (switching = false)}
							class="text-muted hover:bg-ink/5 hover:text-ink flex min-h-11 items-center gap-2 rounded px-2 py-1.5 text-sm md:min-h-0"
						>
							<Users size={15} class="shrink-0" />
							<span class="truncate">People and rooms</span>
						</a>
					</li>
				</ul>
			{/if}
		</div>
	{/if}
	{#if crew && crews.length > 1}
		<!-- What the crews you are NOT looking at are doing (#1148): one crew
		     at a time hides three quarters of the radar, and this is the price
		     option C pays back. One plain line per crew with something on —
		     riders on watts (the watt token, live data), people in voice,
		     unread (the muted mark, #568) — and NOTHING for a quiet crew, not
		     even its icon: when nothing is happening anywhere there is no row
		     at all. Tapping a line switches to that crew. -->
		{@const elsewhere = crews
			.filter((c) => c.id !== crew.id)
			.map((c) => ({ c, pulse: crewPulse(rooms, c.id) }))
			.filter((x) => !quiet(x.pulse))}
		{#if elsewhere.length}
			<ul class="border-ink/5 border-b py-1">
				{#each elsewhere as { c, pulse } (c.id)}
					<li>
						<button
							onclick={() => pick(c.id)}
							class="hover:bg-ink/5 text-muted hover:text-ink flex min-h-8 w-full items-center gap-2 px-4 text-left text-[11px]"
							title="switch to {c.name}"
							aria-label="{c.name} — {pulse.riding} riding, {pulse.voice} in voice, {pulse.unread} new — switch to it"
						>
							<span class="truncate font-medium">{c.name}</span>
							<span class="ml-auto flex shrink-0 items-center gap-2">
								{#if pulse.riding}
									<span class="text-watt/90 flex items-center gap-1"
										><RidingBars size={8} />{pulse.riding} riding</span
									>
								{/if}
								{#if pulse.voice}
									<span class="flex items-center gap-1"
										><Headphones size={9} />{pulse.voice}</span
									>
								{/if}
								{#if pulse.unread}
									<span class={UNREAD_COUNT}>{unreadCount(pulse.unread)}</span>
								{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
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
			{crew && crews.length > 1 ? `rooms · ${crew.name}` : 'rooms'}
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
