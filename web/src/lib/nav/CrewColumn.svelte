<script lang="ts">
	// A crew in the sidebar (ADR-0058, #2447): its pages, then its text
	// channels, then its voice channels — Discord's server column. The crew is
	// the header above (CrewSwitcher); this is what is under it. Every channel
	// here is one the rider may enter: a private one that does not name them
	// is not in the read at all (#2444), so nothing here is a link that fails.
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { confirm } from '$lib/confirm.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { device } from '$lib/device.svelte';
	import { UNREAD_COUNT, unreadCount } from '$lib/messages/unread-marks';
	import type { RoomCrew } from '$lib/room/room-data';
	import { toasts } from '$lib/toast.svelte';
	import Hash from '@lucide/svelte/icons/hash';
	import Headphones from '@lucide/svelte/icons/headphones';
	import Lock from '@lucide/svelte/icons/lock';
	import LockOpen from '@lucide/svelte/icons/lock-open';
	import Plus from '@lucide/svelte/icons/plus';
	import Settings from '@lucide/svelte/icons/settings';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { crewLive, sessionLine, type LiveChannel } from './crew-live.svelte';
	import NewChannel from './NewChannel.svelte';
	import { crewPlaces } from './pages';
	import { railPeople } from './rail-people';

	let { crew, pathname }: { crew: RoomCrew; pathname: string } = $props();

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
		// Deleting takes the scrollback, or the deck's settings, with it and
		// nothing brings them back (errors.md: the genuinely destructive asks).
		const sure = await confirm({
			title: `Delete ${c.kind === 'text' ? '#' : ''}${c.name}?`,
			body:
				c.kind === 'text'
					? 'Every message in it goes too, and nothing brings them back.'
					: 'Its music settings and its play history go too.',
			action: 'Delete the channel',
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
				label: 'Delete the channel',
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
				title="new {kind} channel"
				aria-label="new {kind} channel"><Plus size={16} /></button
			>
		{/if}
	</div>
{/snippet}

{#snippet row(c: LiveChannel)}
	{@const on = lit(pathOf(c))}
	{@const Mark = c.kind === 'text' ? Hash : Volume2}
	<a
		href={pathOf(c)}
		title={MENU_HINT}
		aria-current={on ? 'page' : undefined}
		{@attach contextMenu(() => menu(c))}
		class="flex min-h-11 items-center gap-2 rounded px-2 py-1.5 text-sm md:min-h-0 {on
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
	{@render section('channels', 'text')}
	<ul class="space-y-0.5">
		{#each texts as c (c.id)}
			<li>{@render row(c)}</li>
		{:else}
			<!-- Empty states teach (ux.md): what a text channel is, and who makes one. -->
			<li class="text-muted px-2 py-1 text-xs">
				{admin
					? 'No text channels yet — the + makes the first place to write.'
					: 'No text channels yet. The crew’s owner or an admin makes them.'}
			</li>
		{/each}
	</ul>

	{@render section('voice', 'voice')}
	<ul class="space-y-0.5">
		{#each voices as c (c.id)}
			{@const people = railPeople(c.occupants?.map((o) => o.name))}
			{@const inVoice = c.occupants?.some((o) => o.voice)}
			<li>
				{@render row(c)}
				{#if c.session}
					<!-- What is running, how far in, how many (ADR-0020's radar):
					     the bars carry the watt, the words stay chrome (#1965). -->
					<p
						class="text-ink/85 flex items-center gap-1.5 truncate px-2 pb-1 pl-8 text-[10px]"
					>
						<span class="text-watt"><RidingBars size={9} /></span>
						{sessionLine(c.session)}
					</p>
				{/if}
				{#if people.shown.length}
					<!-- Who is in there, without going in (#438): one line of names,
					     the way a room's row said it — not a strip of faces. -->
					<p
						class="text-muted-dim flex items-center gap-1 truncate px-2 pb-1 pl-8 text-[10px]"
					>
						{#if inVoice}<Headphones size={9} class="shrink-0" />{/if}
						<span class="truncate">{people.label}</span>
					</p>
				{/if}
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

{#if creating}
	<Modal
		label="New {creating} channel"
		onclose={() => (creating = null)}
		class="max-w-sm"
	>
		<NewChannel crew={{ id: crew.id, name: crew.name }} kind={creating} />
	</Modal>
{/if}
