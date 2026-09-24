<script lang="ts">
	// A crew in the sidebar (ADR-0058, #2447): its pages, then its text
	// channels, then its voice channels — Discord's server column. The crew is
	// the header above (CrewSwitcher); this is what is under it. Every channel
	// here is one the rider may enter: a private one that does not name them
	// is not in the read at all (#2444), so nothing here is a link that fails.
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { confirm } from '$lib/confirm.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { deleteChannelWarning, deleteLabel, newLabel } from '$lib/channels';
	import { device } from '$lib/device.svelte';
	import { UNREAD_COUNT, unreadCount } from '$lib/messages/unread-marks';
	import type { CrewRef } from '$lib/crew-types';
	import { channelAddress, sessionPath } from '$lib/channel/address';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { askVoice } from '$lib/channel/voice-intent';
	import { account } from '$lib/account.svelte';
	import { toasts } from '$lib/toast.svelte';
	import Lock from '@lucide/svelte/icons/lock';
	import LockOpen from '@lucide/svelte/icons/lock-open';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Plus from '@lucide/svelte/icons/plus';
	import Settings from '@lucide/svelte/icons/settings';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { crewLive, sessionLine, type LiveChannel } from './crew-live.svelte';
	import NewChannel from './NewChannel.svelte';
	import { crewPlaces } from './pages';
	import { people as faces } from '$lib/people.svelte';
	import { createVoiceMover } from './voice-mover.svelte';
	import VoiceOccupants from './VoiceOccupants.svelte';

	let { crew, pathname }: { crew: CrewRef; pathname: string } = $props();

	const admin = $derived(crew.role === 'owner' || crew.role === 'admin');
	const places = $derived(crewPlaces(crew.id, admin, device.narrow));
	const live = $derived(crewLive.crew(crew.id));
	const texts = $derived(live?.channels.filter((c) => c.kind === 'text') ?? []);
	const voices = $derived(
		live?.channels.filter((c) => c.kind === 'voice') ?? [],
	);
	const pathOf = (c: LiveChannel) =>
		`/crew/${crew.id}/${c.kind === 'text' ? 'c' : 'v'}/${c.id}`;
	// One lit row (ADR-0020 rule 1): a channel's own pages light its row, and
	// the crew's Home only its exact path.
	const lit = (href: string, exact = false) =>
		exact
			? pathname === href
			: pathname === href || pathname.startsWith(`${href}/`);

	/**
	 * A voice channel's click is the tap that joins its voice (#2702,
	 * ADR-0010's click amendment); the channel page takes the note on mount.
	 * A new-tab click opens a page this tab never mounts, so it leaves none.
	 * The channel you already stand in has no page to mount: join it here.
	 */
	function joinOnClick(c: LiveChannel, e: MouseEvent) {
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
			return;
		if (!account.me?.avEnabled) return;
		const { key } = channelAddress(crew.id, c.id, c.name);
		const here = channelConnection.current;
		if (here?.address.key === key) void here.av.join();
		else askVoice(key, here?.av, Date.now());
	}

	// Who is in a voice channel, spelled out (#2702): one channel open at a
	// time, so the column never grows by more than one list.
	let unfolded = $state<string | null>(null);

	// Dragging a name onto another channel moves the rider (#2730, #2745).
	const mover = createVoiceMover({ admin: () => admin, voices: () => voices });

	let creating = $state<'text' | 'voice' | null>(null);
	$effect(() => {
		pathname;
		creating = null;
	});

	async function patch(c: LiveChannel, json: Record<string, unknown>) {
		const res = await api(`/api/channels/${c.id}`, { method: 'PATCH', json });
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		void crewLive.reload();
	}
	async function remove(c: LiveChannel) {
		// Nothing brings a deleted channel back (errors.md: the genuinely
		// destructive asks).
		const sure = await confirm({
			title: `Delete ${c.name}?`,
			body: deleteChannelWarning(c),
			action: deleteLabel(c.kind),
			cancel: 'Keep it',
		});
		if (!sure) return;
		const res = await api(`/api/channels/${c.id}`, { method: 'DELETE' });
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		if (pathname.startsWith(pathOf(c))) void goto(`/crew/${crew.id}`);
		void crewLive.reload();
	}

	// A channel's menu (ux.md): open is the click, and the rest is here —
	// read, then the admin's gate and delete, delete last and in danger.
	function menu(c: LiveChannel): MenuEntry[] {
		const entries: MenuEntry[] = [
			{ label: 'Open', icon: ArrowRight, onSelect: () => void goto(pathOf(c)) },
		];
		if (c.kind === 'text' && c.unread)
			entries.push({
				label: 'Mark as read',
				icon: CheckCheck,
				onSelect: async () => {
					await api(`/api/channels/${c.id}/read`, { method: 'POST' });
					void crewLive.reload();
				},
			});
		if (!admin) return entries;
		entries.push(
			'separator',
			c.private
				? {
						label: 'Open it to the crew',
						icon: LockOpen,
						onSelect: () => void patch(c, { private: false }),
					}
				: {
						label: 'Make it private',
						icon: Lock,
						onSelect: () => void patch(c, { private: true }),
					},
			{
				label: 'Rename in settings',
				icon: Settings,
				onSelect: () => void goto(`/crew/${crew.id}/settings`),
			},
			'separator',
			{
				label: deleteLabel(c.kind),
				icon: Trash2,
				danger: true,
				onSelect: () => void remove(c),
			},
		);
		return entries;
	}
</script>

{#snippet section(label: string, kind: 'text' | 'voice')}
	<div class="eyebrow flex items-center px-2 pt-4 pb-1">
		{label}
		{#if admin}
			<button
				onclick={() => (creating = kind)}
				class="hover:text-ink -my-2 ml-auto grid h-11 w-11 place-items-center md:h-6 md:w-6"
				title={newLabel(kind).toLowerCase()}
				aria-label={newLabel(kind).toLowerCase()}><Plus size={16} /></button
			>
		{/if}
	</div>
{/snippet}

{#snippet row(c: LiveChannel)}
	{@const on = lit(pathOf(c))}
	{@const Mark = c.kind === 'text' ? MessageCircle : Volume2}
	<a
		href={pathOf(c)}
		onclick={c.kind === 'voice' ? (e) => joinOnClick(c, e) : undefined}
		title={MENU_HINT}
		aria-current={on ? 'page' : undefined}
		{@attach contextMenu(() => menu(c))}
		class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-sm md:min-h-0 {on
			? 'bg-ink/10 text-ink'
			: c.unread
				? 'text-ink/85 hover:bg-ink/5 font-medium'
				: 'text-muted hover:bg-ink/5 hover:text-ink'}"
	>
		<Mark size={15} class="shrink-0" />
		<span class="min-w-0 flex-1 truncate">{c.name}</span>
		{#if c.private}
			<Lock size={11} class="text-muted-dim shrink-0" aria-label="private" />
		{/if}
		{#if c.unread}
			<span class={UNREAD_COUNT}>{unreadCount(c.unread)}</span>
		{/if}
	</a>
{/snippet}

<ul class="space-y-0.5">
	{#each places as entry (entry.href)}
		{@const on = lit(entry.href, entry.exact)}
		<li>
			<a
				href={entry.href}
				aria-current={on ? 'page' : undefined}
				class="flex min-h-11 items-center gap-2 rounded px-2 py-1.5 text-sm md:min-h-0 {on
					? 'bg-ink/10 text-ink'
					: 'text-muted hover:bg-ink/5 hover:text-ink'}"
			>
				<entry.icon size={15} class="shrink-0" />
				{entry.label}
			</a>
		</li>
	{/each}
</ul>

{#if !live}
	<!-- All four states (errors.md): loading, failed, empty, content. -->
	{#if !crewLive.loaded}
		<div class="space-y-1 px-2 pt-4"><Skeleton rows={3} class="h-5" /></div>
	{:else if crewLive.error}
		<p class="text-muted px-2 pt-4 text-xs">
			{crewLive.error}
			<button onclick={() => crewLive.reload()} class="btn-link">Retry</button>
		</p>
	{/if}
{:else}
	{@render section('chat channels', 'text')}
	<ul class="space-y-0.5">
		{#each texts as c (c.id)}
			<li>{@render row(c)}</li>
		{:else}
			<!-- Empty states teach (ux.md): what a chat channel is, and who makes one. -->
			<li class="text-muted px-2 py-1 text-xs">
				{admin
					? 'No chat channels yet — the + makes the first place to write.'
					: 'No chat channels yet. The crew’s owner or an admin makes them.'}
			</li>
		{/each}
	</ul>

	{@render section('voice channels', 'voice')}
	<ul class="space-y-0.5">
		{#each voices as c (c.id)}
			{@const count = mover.occupants(c).length}
			{@const open = unfolded === c.id}
			<!-- A place a dragged name can land (#2745): while one is in the air,
			     every other channel shows a quiet dashed edge, and the one under
			     the pointer fills in. -->
			<li
				{...mover.target(c)}
				class="rounded outline-1 -outline-offset-1 transition-[background-color,outline-color] duration-150 motion-reduce:transition-none {mover.dropOn ===
				c.id
					? 'bg-neon/15 outline-neon/70 outline'
					: mover.dragging && mover.dragging.from !== c.id
						? 'outline-neon/35 outline outline-dashed'
						: 'outline-transparent'}"
			>
				<div class="flex items-center">
					{@render row(c)}
					{#if count}
						<button
							onclick={() => (unfolded = open ? null : c.id)}
							aria-expanded={open}
							aria-label="{open ? 'Hide' : 'Show'} who is in {c.name}"
							title="{open ? 'Hide' : 'Show'} who is in {c.name}"
							class="text-muted hover:text-ink grid h-11 w-11 shrink-0 place-items-center rounded md:h-6 md:w-6"
							><ChevronRight
								size={14}
								class="transition-transform motion-reduce:transition-none {open
									? 'rotate-90'
									: ''}"
							/></button
						>
					{/if}
				</div>
				{#if c.session}
					{@const href = sessionPath(crew.id, c.session.id)}
					{@const on = lit(href)}
					<!-- What is running, how far in, how many (ADR-0020's radar):
					     the bars carry the watt, the words stay chrome (#1965).
					     And the way in from anywhere in the crew (#2450): the
					     session's own page, which joins no voice by itself. -->
					<a
						{href}
						aria-current={on ? 'page' : undefined}
						title="join the ride"
						class="flex min-h-11 items-center gap-1.5 truncate rounded px-2 pb-1 pl-8 text-[10px] md:min-h-0 {on
							? 'bg-ink/10 text-ink'
							: 'text-ink/85 hover:bg-ink/5 hover:text-ink'}"
					>
						<span class="text-watt"><RidingBars size={9} /></span>
						{sessionLine(c.session)}
					</a>
				{/if}
				<VoiceOccupants channel={c} {open} {mover} />
			</li>
		{:else}
			<li class="text-muted px-2 py-1 text-xs">
				{admin
					? 'No voice channels yet — the + makes the first place to ride together.'
					: 'No voice channels yet. The crew’s owner or an admin makes them.'}
			</li>
		{/each}
	</ul>
{/if}

<svelte:window
	ondragover={mover.window.ondragover}
	ondrop={mover.window.ondrop}
	ondragend={mover.window.ondragend}
/>

<!-- The drag preview: the rider, not a snapshot of their row. Off screen and
     aria-hidden; the browser photographs it at the start of each drag. -->
<div
	{@attach mover.ghostHere}
	aria-hidden="true"
	class="bg-surface-raised text-ink ring-neon/40 pointer-events-none fixed top-0 -left-[9999px] flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-xs font-medium shadow-lg ring-1"
>
	{#if mover.ghostOf}
		{@const face = faces.face(mover.ghostOf.id)}
		<Avatar name={mover.ghostOf.name} avatarUrl={face?.avatarUrl} size={20} />
		{mover.ghostOf.name}
	{/if}
</div>

{#if creating}
	<Modal
		label={newLabel(creating)}
		onclose={() => (creating = null)}
		class="max-w-sm"
	>
		<NewChannel crew={{ id: crew.id, name: crew.name }} kind={creating} />
	</Modal>
{/if}
