<script lang="ts">
	// The crew's rooms (#1149, #1201, #1226): each row's access state, the
	// permission menu for the crew's owner and admins, and the door to open one
	// more. Split from the page (#1234); the page reloads on `onchange`.
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import OpenOrJoin from '$lib/rooms/OpenOrJoin.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { setRoomAccess, type Crew } from '$lib/crew';
	import { accessMark, reachable } from '$lib/nav/crews';
	import { presence } from '$lib/presence.svelte';
	import { toasts } from '$lib/toast.svelte';
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import Eye from '@lucide/svelte/icons/eye';
	import Plus from '@lucide/svelte/icons/plus';

	let {
		crew,
		administers,
		onchange,
	}: { crew: Crew; administers: boolean; onchange: () => void } = $props();

	// Opening a room in THIS crew (#1201), for the people who may.
	let opening = $state(false);

	// A room row's menu (#1226): crew owner and admins open a room to the crew
	// or shut it — "crew admins manage room permissions" (ADR-0038), and the
	// one thing the `admin` access state is for. The primary click stays the
	// door; this holds the permission.
	// One toggle for the row's button and its menu entry (#1372): the
	// admin-state row is the one an admin came here to act on, and it used
	// to look disabled with its only action three fingers away in a menu.
	const accessLabel = (room: Crew['rooms'][number]) =>
		room.access === 'open' ? 'Make private' : 'Open to the crew';
	function toggleAccess(room: Crew['rooms'][number]) {
		const crewId = crew.id;
		const open = room.access === 'open';
		void setRoomAccess(crewId, room.id, !open).then((res) => {
			if (!res.ok) {
				toasts.push(res.error.message, { tone: 'error' });
				return;
			}
			// A shut takes the listing with it (#1671), so the toast says so
			// and the undo restores both — reopening alone never could (#1929).
			toasts.push(
				open
					? `${room.name} is private now — its members, and whoever you let in${room.listed ? ', and it leaves the directory' : ''}.`
					: `${room.name} is open to the crew.`,
				{
					undo: () =>
						void setRoomAccess(
							crewId,
							room.id,
							open,
							open ? room.listed : undefined,
						),
				},
			);
			presence.reload();
			onchange();
		});
	}
	function roomEntries(room: Crew['rooms'][number]): MenuEntry[] {
		if (!administers) return [];
		return [
			{
				label: accessLabel(room),
				icon: room.access === 'open' ? Eye : DoorOpen,
				onSelect: () => toggleAccess(room),
			},
		];
	}
</script>

{#if opening}
	<Modal label="Open a room" onclose={() => (opening = false)} class="max-w-sm">
		<OpenOrJoin
			compact
			crew={{ id: crew.id, name: crew.name, icon: crew.icon, role: crew.role }}
		/>
	</Modal>
{/if}

{#snippet openOne()}
	<button onclick={() => (opening = true)} class="btn btn-primary btn-xs"
		><Plus size={13} /> Open a room here</button
	>
{/snippet}

<div class="mt-8 flex items-end justify-between gap-3">
	<h2 class="eyebrow">rooms</h2>
	{#if administers && crew.rooms.length > 0}
		<button onclick={() => (opening = true)} class="btn btn-secondary btn-xs"
			><Plus size={13} /> Open a room here</button
		>
	{/if}
</div>
{#if crew.rooms.length === 0}
	<!-- A crew with no rooms is still a crew (#1236); an empty bordered box
	     under "rooms" taught nothing (ux.md). -->
	<div class="mt-2">
		<EmptyState cta={administers ? openOne : undefined}>
			{#if administers}
				A room is a channel of the crew — open one and everyone here can walk
				in.
			{:else}
				No rooms yet. A room is a channel of the crew; its owner or an admin
				opens the first one.
			{/if}
		</EmptyState>
	</div>
{:else}
	<ul class="divide-ink/5 panel mt-2 divide-y">
		{#each crew.rooms as room (room.id)}
			{@const mark = accessMark(room.access)}
			{@const open = reachable(room.access) && !!room.slug}
			<li
				title={administers ? MENU_HINT : undefined}
				class="flex items-center gap-2 {administers ? 'pr-3' : ''}"
				{@attach contextMenu(() => roomEntries(room))}
			>
				<svelte:element
					this={open ? 'a' : 'div'}
					href={open ? `/r/${room.slug}` : undefined}
					title={open ? undefined : mark?.label}
					class="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-sm {open
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
				{#if administers}
					<button
						onclick={() => toggleAccess(room)}
						class="btn btn-ghost btn-xs shrink-0">{accessLabel(room)}</button
					>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
