<script lang="ts">
	// The crew header and its switcher (ADR-0020 amended, #1147; #1238;
	// #1327): the crew is the mode the sidebar is in, so its row is the
	// column's first — the header, the way Discord's server name is — drawn
	// as one more nav row, not a boxed card: the same 16 px left edge, the
	// same icon slot and label as Home below it, one step larger because it
	// holds everything under it. Opening it expands the crews in place, plain
	// rows at the same indentation; nothing floats, nothing is rounded,
	// nothing is inset.
	// Under it, one line per crew you are NOT looking at with something on
	// (#1148). The sidebar owns which crew is chosen and hands it in.
	import CrewMark from '$lib/components/CrewMark.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import { account } from '$lib/account.svelte';
	import { contextMenu, type MenuEntry } from '$lib/context-menu.svelte';
	import { copyInviteLink, leaveCrewFlow } from '$lib/crew-flows';
	import { UNREAD_COUNT, unreadCount } from '$lib/messages/unread-marks';
	import { toasts } from '$lib/toast.svelte';
	import type { RailRoom } from '$lib/room/mockcompat';
	import type { RoomCrew } from '$lib/room/room-data';
	import { crewPulse, dismissIntro, introDismissed, quiet } from './crews';
	import { goto } from '$app/navigation';
	import Check from '@lucide/svelte/icons/check';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import Headphones from '@lucide/svelte/icons/headphones';
	import Link from '@lucide/svelte/icons/link';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Settings from '@lucide/svelte/icons/settings';
	import Shield from '@lucide/svelte/icons/shield';
	import Users from '@lucide/svelte/icons/users';

	let {
		crews,
		crew,
		rooms,
		onpick,
	}: {
		/** Every crew the room list mentions, once each. */
		crews: RoomCrew[];
		/** The one on screen. */
		crew: RoomCrew;
		rooms: RailRoom[];
		/** The rider chose another crew; the sidebar remembers it. */
		onpick: (id: string) => void;
	} = $props();

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
				onSelect: () => void copyInviteLink(code),
			});
		}
		// Disabled with the reason rather than withheld (ux.md): the owner's
		// route out is handing the crew on, and the menu says so.
		entries.push('separator', {
			label: 'Leave the crew',
			icon: LogOut,
			danger: true,
			disabled: c.role === 'owner' || owned.length > 0,
			hint:
				c.role === 'owner'
					? 'hand the crew on first'
					: owned.length
						? 'you own a room here'
						: undefined,
			onSelect: () => void leaveCrewFlow(c),
		});
		return entries;
	}
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

<!-- The crew is the mode the whole column is in (ADR-0020 amended,
     #1147), so it sits at the top like Discord's server header — drawn
     as one more nav row, not a boxed card (#1238): the same 16 px left
     edge, the same icon slot and label as Home below it. Opening it
     expands the crews in place, plain rows at the same indentation;
     nothing floats, nothing is rounded, nothing is inset. -->
<div class="px-2 pt-2" bind:this={header}>
	{#snippet crewRow(c: RoomCrew)}
		<CrewMark name={c.name} icon={c.icon} imageUrl={c.imageUrl} size={24} />
		<span
			class="font-display min-w-0 flex-1 truncate text-[15px] leading-5 font-bold"
			>{c.name}</span
		>
		{#if c.role === 'owner'}
			<Shield size={12} class="text-muted/60 shrink-0" aria-label="yours" />
		{/if}
	{/snippet}
	{#if crews.length > 1}
		<button
			onclick={() => (switching = !switching)}
			{@attach contextMenu(() => crewEntries(crew))}
			class="hover:bg-ink/5 flex min-h-11 w-full items-center gap-2 rounded p-2 text-left md:min-h-0 {switching
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
			{@attach contextMenu(() => crewEntries(crew))}
			class="hover:bg-ink/5 text-ink flex min-h-11 w-full items-center gap-2 rounded p-2 md:min-h-0"
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
							onpick(c.id);
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
						<span class="text-muted shrink-0 text-[11px]">{crewLine(c)}</span>
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

{#if crews.length > 1}
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
						onclick={() => onpick(c.id)}
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
