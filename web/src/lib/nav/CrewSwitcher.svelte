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
	//
	// "You" is the first entry (ADR-0058, decision 5; #2447): the rider's own
	// Home, Workouts, Rides, Music and Friends are a mode like a crew is —
	// the #1023 amendment's "the crew is a mode, not a level", finished.
	import { account } from '$lib/account.svelte';
	import CrewMark from '$lib/components/CrewMark.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import { contextMenu, type MenuEntry } from '$lib/context-menu.svelte';
	import {
		leaveCrewFlow,
		MAIN_CREW_LABEL,
		makeMainCrewFlow,
		shareInviteLink,
	} from '$lib/crew-flows';
	import { UNREAD_COUNT, unreadCount } from '$lib/messages/unread-marks';
	import type { CrewRef } from '$lib/crew-types';
	import { shareVerb } from '$lib/share';
	import { quiet } from './crews';
	import { crewLive, livePulse } from './crew-live.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { goto } from '$app/navigation';
	import { presence } from '$lib/presence.svelte';
	import Check from '@lucide/svelte/icons/check';
	import CloudOff from '@lucide/svelte/icons/cloud-off';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import Headphones from '@lucide/svelte/icons/headphones';
	import Link from '@lucide/svelte/icons/link';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Settings from '@lucide/svelte/icons/settings';
	import Shield from '@lucide/svelte/icons/shield';
	import Star from '@lucide/svelte/icons/star';
	import Users from '@lucide/svelte/icons/users';

	let {
		crews,
		crew,
		onpick,
	}: {
		/** Every crew the rider is in, once each. */
		crews: CrewRef[];
		/** The one on screen; null is You. */
		crew: CrewRef | null;
		/** The rider chose a crew, or 'you'. */
		onpick: (id: string) => void;
	} = $props();

	// Not lit itself (#2447): the crew's own rows under it — Home, Members,
	// Settings, its channels — light for its pages, so the header lighting
	// too would make two (ADR-0020 rule 1).

	// What the header says under the name: how many channels, and what you are
	// to it. Owner is a word here because the shield alone is a small mark;
	// member says nothing, being in it at all is the default.
	// The one number that tells two crews apart at a glance (#1238): the
	// role words went — the header's mark says "yours", and the crew page
	// says the rest.
	// ...and which one is the main crew (#2144): the one the sidebar opens
	// in on every device.
	function crewLine(c: CrewRef): string {
		const n = crewLive.crew(c.id)?.channels.length ?? 0;
		const count = n === 1 ? '1 channel' : `${n} channels`;
		return c.id === account.me?.homeCrewId ? `${count} · main` : count;
	}
	// The crew's menu (#1257, ux.md): everything about the crew that is a
	// page or two away, from the row that names it. The click stays the
	// primary action; nothing here lives only in the menu.
	function crewEntries(c: CrewRef): MenuEntry[] {
		const entries: MenuEntry[] = [
			{
				label: 'Members',
				icon: Users,
				onSelect: () => void goto(`/crew/${c.id}/members`),
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
				label: `${shareVerb()} invite link`,
				icon: Link,
				onSelect: () => void shareInviteLink(code),
			});
		}
		// The main crew (#2144): only a choice when there is one to make, and
		// the crew page offers the same button — nothing lives only here.
		if (crews.length > 1 && account.me?.homeCrewId !== c.id)
			entries.push({
				label: MAIN_CREW_LABEL,
				icon: Star,
				onSelect: () => void makeMainCrewFlow(c),
			});
		// Disabled with the reason rather than withheld (ux.md): the owner's
		// route out is handing the crew on, and the menu says so.
		entries.push('separator', {
			label: 'Leave the crew',
			icon: LogOut,
			danger: true,
			disabled: c.role === 'owner',
			hint: c.role === 'owner' ? 'hand the crew on first' : undefined,
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
		// A row's own menu is outside the header but is the list's: closing
		// the list on its pointerdown unmounts the row, which takes the menu
		// with it before the click lands (#2447).
		const away = (e: PointerEvent) => {
			const target = e.target as Element;
			if (header?.contains(target) || target.closest?.('[role="menu"]')) return;
			switching = false;
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
</script>

<!-- The crew is the mode the whole column is in (ADR-0020 amended,
     #1147), so it sits at the top like Discord's server header — drawn
     as one more nav row, not a boxed card (#1238): the same 16 px left
     edge, the same icon slot and label as Home below it. Opening it
     expands the crews in place, plain rows at the same indentation;
     nothing floats, nothing is rounded, nothing is inset. -->
<div class="px-2 pt-2" bind:this={header}>
	{#snippet crewRow(c: CrewRef)}
		<CrewMark name={c.name} icon={c.icon} imageUrl={c.imageUrl} size={24} />
		<span
			class="font-display min-w-0 flex-1 truncate text-[15px] leading-5 font-bold"
			>{c.name}</span
		>
		{#if c.role === 'owner'}
			<Shield size={12} class="text-muted-dim shrink-0" aria-label="yours" />
		{/if}
	{/snippet}
	{#snippet youRow()}
		<Avatar
			name={account.me?.displayName ?? 'You'}
			avatarUrl={account.me?.avatarUrl}
			size={24}
		/>
		<span
			class="font-display min-w-0 flex-1 truncate text-[15px] leading-5 font-bold"
			>You</span
		>
	{/snippet}
	<!-- Always a switch while there is a crew to switch to: You is an entry
	     too (#2447), so a rider in one crew still has two places to be. -->
	<button
		onclick={() => (switching = !switching)}
		{@attach contextMenu(() => (crew ? crewEntries(crew) : []))}
		class="hover:bg-ink/5 text-ink flex min-h-11 w-full items-center gap-2 rounded p-2 text-left md:min-h-0 {switching
			? 'bg-ink/5'
			: ''}"
		title="switch crew"
		aria-label="{crew ? `crew: ${crew.name}` : 'You'} — switch crew"
		aria-expanded={switching}
	>
		{#if crew}{@render crewRow(crew)}{:else}{@render youRow()}{/if}
		<!-- What is under this header stopped updating (#1743, #2518): the crew
		     list or the crews' live read, either one. The channel list,
		     the presence dots and "32 min in" are frozen at whatever they last
		     were, and with rooms already on screen nothing else in the column
		     says so — the error line below only draws over an EMPTY list, so a
		     rider with rooms read a confident, stale radar for as long as the
		     feed stayed down. Two failed reads in a row, never one: the 60 s
		     fallback poll covers a blip, and a mark that flickers on every blip
		     is a mark people learn to ignore.
		     Chrome, so muted ink and no glow (ADR-0005) — nothing here is live
		     data, which is the whole point of it. Not a button: the header it
		     sits in is one, the feed retries itself every 60 s and on the tab
		     coming back, and the empty-list retry below is unchanged. -->
		{#if presence.stale || crewLive.stale}
			<span
				class="text-muted-dim shrink-0"
				title="Not updating — the last reads failed, so what is below may be out of date. Retrying."
			>
				<CloudOff size={12} aria-label="not updating — retrying" />
			</span>
		{/if}
		<ChevronsUpDown size={14} class="text-muted shrink-0" />
	</button>
	{#if switching}
		<!-- A list, not a menu: role="menu" promises arrow-key walking and
		     Home/End, and a reader that hears the promise finds Tab instead
		     (audit 2026-09-09). Plain buttons in a list say what they are. -->
		<ul class="mt-0.5 space-y-0.5">
			<li>
				<button
					onclick={() => {
						onpick('you');
						switching = false;
					}}
					class="flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm md:min-h-0 {crew
						? 'text-muted hover:bg-ink/5 hover:text-ink'
						: 'bg-ink/10 text-ink'}"
					aria-current={crew ? undefined : 'true'}
				>
					<Avatar
						name={account.me?.displayName ?? 'You'}
						avatarUrl={account.me?.avatarUrl}
						size={20}
					/>
					<span class="min-w-0 flex-1 truncate">You</span>
					<span class="text-muted shrink-0 text-[11px]">your own pages</span>
					{#if !crew}<Check size={13} class="text-muted shrink-0" />{/if}
				</button>
			</li>
			{#each crews as c (c.id)}
				{@const now = c.id === crew?.id}
				<li>
					<button
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
		</ul>
	{/if}
</div>

{#if crews.length > 0}
	<!-- What the crews you are NOT looking at are doing (#1148): one crew
	     at a time hides three quarters of the radar, and this is the price
	     option C pays back. One plain line per crew with something on —
	     riders on watts (the watt token, live data), people in voice,
	     unread (the muted mark, #568) — and NOTHING for a quiet crew, not
	     even its icon: when nothing is happening anywhere there is no row
	     at all. Tapping a line switches to that crew. -->
	{@const elsewhere = crews
		.filter((c) => c.id !== crew?.id)
		.map((c) => ({ c, pulse: livePulse(crewLive.crew(c.id)) }))
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
