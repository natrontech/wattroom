<script lang="ts">
	// The crew's own page (ADR-0038; #1150, #1151): its name, its rooms with
	// what you may do in each, its people with their crew roles, and — for
	// the owner and admins — the people it banned, with the one control that
	// lifts a crew ban and says what it does not reach. Nothing live: the
	// crew carries no voice, deck, session or metrics.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import CrewMark from '$lib/components/CrewMark.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import OpenOrJoin from '$lib/rooms/OpenOrJoin.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import {
		fetchCrew,
		inviteLink,
		joinCrew,
		leaveCrew as leaveCrewApi,
		setCrewRole,
		setRoomAccess,
		transferCrew,
		type Crew,
		type CrewPerson,
	} from '$lib/crew';
	import { accessMark, reachable } from '$lib/nav/crews';
	import { personMenu } from '$lib/person-menu';
	import { presence } from '$lib/presence.svelte';
	import { toasts } from '$lib/toast.svelte';
	import Copy from '@lucide/svelte/icons/copy';
	import Crown from '@lucide/svelte/icons/crown';
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import Eye from '@lucide/svelte/icons/eye';
	import Plus from '@lucide/svelte/icons/plus';
	import Settings from '@lucide/svelte/icons/settings';
	import Shield from '@lucide/svelte/icons/shield';
	import ShieldBan from '@lucide/svelte/icons/shield-ban';
	import ShieldOff from '@lucide/svelte/icons/shield-off';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const id = $derived(page.params.id ?? '');
	let crew = $state<Crew | null>(untrack(() => data.crew));
	let error = $state<string | null>(untrack(() => data.error));
	let loadedId = $state<string | null>(untrack(() => data.id));
	let busy = $state(false);

	async function load(which: string) {
		const res = await fetchCrew(which);
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		crew = res.data;
	}

	$effect(() => {
		const which = id;
		if (!which || loadedId === which) return;
		if (data.id === which) {
			crew = data.crew;
			error = data.error;
			loadedId = which;
			return;
		}
		loadedId = which;
		crew = null;
		error = null;
		void load(which);
	});
	$effect(() => {
		// A role change or a rename pings the lobby (#570); re-read on it.
		presence.version;
		const loaded = untrack(() => crew);
		if (id && loaded) void load(id);
	});

	const administers = $derived(
		crew?.role === 'owner' || crew?.role === 'admin',
	);
	const owner = $derived(crew?.role === 'owner');
	// Opening a room in THIS crew (#1201), for the people who may.
	let opening = $state(false);

	async function act(
		person: CrewPerson,
		role: 'admin' | 'member' | 'banned',
		message: string,
	) {
		if (!crew) return;
		busy = true;
		const res = await setCrewRole(crew.id, person.id, role);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		toasts.push(message);
		await load(crew.id);
	}

	// Banning at the crew is reversible here (the unban below sets it right
	// back), so an undo toast rather than a confirm — the same shape the
	// room's Members place uses (#666, errors.md).
	function ban(person: CrewPerson) {
		const previous = person.role === 'admin' ? 'admin' : 'member';
		if (!crew) return;
		const crewId = crew.id;
		void setCrewRole(crewId, person.id, 'banned').then((res) => {
			if (!res.ok) {
				toasts.push(res.error.message, { tone: 'error' });
				return;
			}
			toasts.push(`Banned ${person.displayName} from the crew.`, {
				undo: () => void setCrewRole(crewId, person.id, previous),
			});
			void load(crewId);
		});
	}

	const canAct = (person: CrewPerson) =>
		administers &&
		person.role !== 'owner' &&
		person.id !== account.me?.id &&
		!busy;

	// Handing the crew on (#1208) is the one thing here behind a confirm
	// rather than an undo toast: the actor cannot take it back — only the
	// new owner can hand it back to them.
	let handover = $state<CrewPerson | null>(null);
	async function handOver() {
		const to = handover;
		handover = null;
		if (!crew || !to) return;
		busy = true;
		const res = await transferCrew(crew.id, to.id);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		toasts.push(`${to.displayName} owns ${crew.name} now. You are an admin.`);
		presence.reload();
		await load(crew.id);
	}

	function personEntries(person: CrewPerson): MenuEntry[] {
		const entries: MenuEntry[] = personMenu(person.id, goto, {
			you: person.id === account.me?.id,
		});
		if (!canAct(person)) return entries;
		entries.push(
			'separator',
			person.role === 'admin'
				? {
						label: 'Make member',
						icon: ShieldOff,
						onSelect: () =>
							act(person, 'member', `${person.displayName} is a member now.`),
					}
				: {
						label: 'Make crew admin',
						icon: Shield,
						onSelect: () =>
							act(
								person,
								'admin',
								`${person.displayName} is a crew admin now.`,
							),
					},
		);
		if (owner)
			entries.push({
				label: `Hand the crew to ${person.displayName}`,
				icon: Crown,
				onSelect: () => (handover = person),
			});
		// A room owner cannot be banned from the crew their room is in (#1212):
		// the entry stays, says why, and does nothing — never a 409 on click.
		entries.push({
			label: 'Ban from the crew',
			icon: ShieldBan,
			onSelect: () => ban(person),
			danger: true,
			disabled: person.ownsRoom,
			hint: person.ownsRoom ? 'owns a room here' : undefined,
		});
		return entries;
	}

	// A room row's menu (#1226): crew owner and admins open a room to the crew
	// or shut it — "crew admins manage room permissions" (ADR-0038), and the
	// one thing the `admin` access state is for. The primary click stays the
	// door; this holds the permission.
	function roomEntries(room: Crew['rooms'][number]): MenuEntry[] {
		if (!administers || !crew) return [];
		const crewId = crew.id;
		const open = room.access === 'open';
		return [
			{
				label: open ? 'Make private' : 'Open to the crew',
				icon: open ? Eye : DoorOpen,
				onSelect: () =>
					void setRoomAccess(crewId, room.id, !open).then((res) => {
						if (!res.ok) {
							toasts.push(res.error.message, { tone: 'error' });
							return;
						}
						toasts.push(
							open
								? `${room.name} is private now — its members, and whoever you let in.`
								: `${room.name} is open to the crew.`,
							{ undo: () => void setRoomAccess(crewId, room.id, open) },
						);
						presence.reload();
						void load(crewId);
					}),
			},
		];
	}

	// The invite (#1236): the crew's code and its link, every member's to
	// share — rooms have no codes of their own any more.
	async function copyInvite() {
		if (!crew?.code) return;
		await navigator.clipboard.writeText(inviteLink(crew.code));
		toasts.push('Invite link copied.');
	}

	// Leaving the crew (#1228, #1236): one call takes the membership and every
	// room of the crew you were in. Refused up front when you own a room here:
	// a room never leaves its crew, so neither can its owner — hand it on
	// first (#1227). Undo rejoins by the code the client still holds.
	const myRooms = $derived(
		presence.rooms.filter((r) => r.crew?.id === crew?.id && !!r.role),
	);
	const ownedHere = $derived(myRooms.filter((r) => r.role === 'owner'));
	async function leaveCrew() {
		if (!crew || ownedHere.length) return;
		const leaving = crew;
		const standing = myRooms.some(
			(r) => r.slug === roomConnection.current?.slug,
		);
		busy = true;
		const res = await leaveCrewApi(leaving.id);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		if (standing) roomConnection.leave();
		presence.reload();
		const code = leaving.code;
		toasts.push(`You left ${leaving.name}.`, {
			undo: code
				? () => void joinCrew(code).then(() => presence.reload())
				: undefined,
		});
		await goto('/home');
	}

	const roleWord = (role: CrewPerson['role']) =>
		role === 'owner' ? 'owner' : role === 'admin' ? 'admin' : 'member';
</script>

<svelte:head>
	<title>{crew?.name ?? 'Crew'} · WattRoom</title>
</svelte:head>

{#if handover && crew}
	<Modal label="Hand the crew on" onclose={() => (handover = null)}>
		<h2 class="font-display text-lg font-bold">
			Hand {crew.name} to {handover.displayName}?
		</h2>
		<p class="text-muted mt-2 text-sm">
			They become its owner — the one person nobody can demote, remove or ban —
			and you stay on as an admin. You cannot take this back; only they can hand
			it back to you.
		</p>
		<div class="mt-4 flex justify-end gap-2">
			<button onclick={() => (handover = null)} class="btn btn-secondary"
				>Cancel</button
			>
			<button onclick={handOver} disabled={busy} class="btn btn-primary"
				>Hand it over</button
			>
		</div>
	</Modal>
{/if}

{#if opening && crew}
	<Modal label="Open a room" onclose={() => (opening = false)} class="max-w-sm">
		<OpenOrJoin compact crewId={crew.id} />
	</Modal>
{/if}

<main class="page">
	{#if error}
		<Banner>{error}</Banner>
	{:else if !crew}
		<Skeleton class="h-8 w-48" />
		<Skeleton class="mt-6 h-40" />
	{:else}
		<header class="flex items-start gap-3">
			<CrewMark
				name={crew.name}
				icon={crew.icon}
				imageUrl={crew.imageUrl}
				size={48}
				class="rounded-xl"
			/>
			<div class="min-w-0 flex-1">
				<h1 class="font-display truncate text-2xl font-bold tracking-tight">
					{crew.name}
				</h1>
				<p class="text-muted text-sm">
					{crew.rooms.length === 1 ? '1 room' : `${crew.rooms.length} rooms`}
					· {crew.people.length === 1
						? '1 person'
						: `${crew.people.length} people`}
					{#if owner}
						· yours
					{:else if crew.role === 'admin'}
						· you admin it
					{/if}
				</p>
			</div>
			{#if administers}
				<!-- Name, picture, icon and the invite live in one place (#1237),
				     the way a room's do; this page is the roster. -->
				<a
					href="/crew/{crew.id}/settings"
					class="btn btn-secondary btn-xs shrink-0"
					><Settings size={13} /> Settings</a
				>
			{/if}
		</header>

		{#if owner && crew.name === account.me?.displayName}
			<!-- The migration's placeholder (#1151): said here, where the name
			     is one click away, until the owner replaces it. -->
			<p class="text-muted mt-2 text-xs">
				Named after you until you rename it — in <a
					href="/crew/{crew.id}/settings"
					class="underline">Settings</a
				>.
			</p>
		{/if}

		{#if crew.code}
			<h2 class="eyebrow mt-8">invite</h2>
			<div class="panel mt-2 flex flex-wrap items-center gap-3 px-4 py-3">
				<span class="min-w-0">
					<span class="eyebrow">crew code</span>
					<span class="font-display block text-lg font-bold tracking-widest"
						>{crew.code}</span
					>
				</span>
				<span class="text-muted min-w-0 flex-1 text-xs">
					Anyone with it joins {crew.name} and walks into its open rooms. Rooms have
					no codes of their own.
				</span>
				<button onclick={copyInvite} class="btn btn-secondary btn-xs shrink-0"
					><Copy size={13} /> Copy invite link</button
				>
			</div>
		{/if}

		<div class="mt-8 flex items-end justify-between gap-3">
			<h2 class="eyebrow">rooms</h2>
			{#if administers}
				<button
					onclick={() => (opening = true)}
					class="btn btn-secondary btn-xs"
					><Plus size={13} /> Open a room here</button
				>
			{/if}
		</div>
		<ul class="divide-ink/5 panel mt-2 divide-y">
			{#each crew.rooms as room (room.id)}
				{@const mark = accessMark(room.access)}
				{@const open = reachable(room.access) && !!room.slug}
				<li
					title={administers ? MENU_HINT : undefined}
					{@attach contextMenu(() => roomEntries(room))}
				>
					<svelte:element
						this={open ? 'a' : 'div'}
						href={open ? `/r/${room.slug}` : undefined}
						title={open ? undefined : mark?.label}
						class="flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm {open
							? 'hover:bg-ink/5 text-ink'
							: 'text-muted/60'}"
					>
						<RoomIcon icon={room.icon} size={15} />
						<span class="min-w-0 flex-1 truncate">{room.name}</span>
						{#if mark}
							<mark.icon
								size={13}
								class="text-muted/60 shrink-0"
								aria-label={mark.label}
							/>
							<span class="text-muted/70 hidden text-[11px] sm:inline"
								>{mark.label}</span
							>
						{/if}
					</svelte:element>
				</li>
			{/each}
		</ul>

		<h2 class="eyebrow mt-8">people</h2>
		<ul class="divide-ink/5 panel mt-2 divide-y">
			{#each crew.people as person (person.id)}
				<li
					class="flex min-h-11 items-center gap-3 px-4 py-2.5"
					title={MENU_HINT}
					{@attach contextMenu(() => personEntries(person))}
				>
					<a href="/u/{person.id}" class="shrink-0">
						<Avatar
							name={person.displayName}
							avatarUrl={person.avatarUrl}
							preset={person.avatarPreset}
							ring="var(--color-surface-raised)"
							size={32}
						/>
					</a>
					<span class="min-w-0 flex-1">
						<span class="flex items-center gap-1.5">
							<a
								href="/u/{person.id}"
								class="hover:text-ink truncate text-sm font-medium hover:underline"
								>{person.displayName}</a
							>
							{#if person.role === 'owner'}
								<Crown size={12} class="text-muted" aria-label="owner" />
							{:else if person.role === 'admin'}
								<Shield size={12} class="text-muted" aria-label="admin" />
							{/if}
						</span>
						<span class="text-muted block text-[11px]">
							{roleWord(person.role)}
							{#if person.rooms}
								· {person.rooms === 1 ? '1 room' : `${person.rooms} rooms`}
							{/if}
							· since {new Date(person.since).toLocaleDateString(undefined, {
								month: 'short',
								year: 'numeric',
							})}
						</span>
					</span>
					{#if canAct(person)}
						<button
							onclick={() =>
								person.role === 'admin'
									? act(
											person,
											'member',
											`${person.displayName} is a member now.`,
										)
									: act(
											person,
											'admin',
											`${person.displayName} is a crew admin now.`,
										)}
							disabled={busy}
							class="btn btn-ghost btn-xs shrink-0"
							>{person.role === 'admin' ? 'Make member' : 'Make admin'}</button
						>
					{/if}
				</li>
			{/each}
		</ul>

		{#if administers && crew.banned?.length}
			<h2 class="eyebrow mt-8">banned from the crew</h2>
			<p class="text-muted mt-1 text-xs">
				Lifting a crew ban restores nothing a room's owner decided — a room that
				banned them stays shut (ADR-0038).
			</p>
			<ul class="divide-ink/5 panel mt-2 divide-y">
				{#each crew.banned as person (person.id)}
					<li class="flex min-h-11 items-center gap-3 px-4 py-2.5">
						<Avatar
							name={person.displayName}
							avatarUrl={person.avatarUrl}
							preset={person.avatarPreset}
							ring="var(--color-surface-raised)"
							size={32}
						/>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium"
								>{person.displayName}</span
							>
							<span class="text-muted block text-[11px]"
								>banned from the crew · {new Date(
									person.since,
								).toLocaleDateString(undefined, {
									month: 'short',
									year: 'numeric',
								})}</span
							>
						</span>
						<!-- Two controls in two places, never one (#1150): this lifts
						     the CREW ban and names what it does not reach. -->
						<span class="flex shrink-0 flex-col items-end gap-0.5">
							<button
								onclick={() =>
									act(
										person,
										'member',
										`${person.displayName} is back in the crew.`,
									)}
								disabled={busy}
								class="btn btn-ghost btn-xs">Unban from {crew.name}</button
							>
							<span class="text-muted/70 text-[11px]"
								>restores nothing a room's owner decided</span
							>
						</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if !owner}
			<!-- The way out (#1228): the one thing a member can do to the crew.
			     Crew membership follows room membership, so it says exactly
			     what it does, and the danger token sits last (ux.md). -->
			<h2 class="eyebrow mt-8">leave</h2>
			<div class="panel mt-2 flex flex-wrap items-center gap-3 px-4 py-3">
				<p class="text-muted min-w-0 flex-1 text-xs">
					{#if ownedHere.length}
						You own {ownedHere.length === 1
							? ownedHere[0].name
							: `${ownedHere.length} rooms`} here, and a room never leaves its crew
						— hand {ownedHere.length === 1 ? 'it' : 'them'} to a member first, then
						leave.
					{:else if myRooms.length}
						Leaving takes you out of {crew.name} and the {myRooms.length === 1
							? 'room'
							: `${myRooms.length} rooms`} of it you are in. The code gets you back.
					{:else}
						Leaving takes you out of {crew.name}. The code gets you back.
					{/if}
				</p>
				<button
					onclick={leaveCrew}
					disabled={busy || !!ownedHere.length}
					class="btn btn-danger btn-xs shrink-0">Leave the crew</button
				>
			</div>
		{/if}
	{/if}
</main>
