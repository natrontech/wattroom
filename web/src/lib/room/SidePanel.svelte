<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		ChevronRight,
		Crown,
		Headphones,
		Mic,
		MicOff,
		Video,
	} from '@lucide/svelte';
	import CheerIcon from '$lib/components/CheerIcon.svelte';
	import { STOCK_CHEERS } from '$lib/icons';
	import { contextMenu } from '$lib/context-menu.svelte';
	import { personMenu } from '$lib/person-menu';
	import { goto } from '$app/navigation';
	import { keepSize } from '$lib/pane';
	import { clampSize, dividerDrag } from '$lib/divider';
	import type { Missed } from '$lib/room/unread';

	// The divider between the room and this column. keepSize's observer saves
	// the width it writes, the same way it did for the native `resize` grip.
	function edgeResize(grip: HTMLElement) {
		const panel = grip.parentElement;
		if (!panel) return;
		return dividerDrag(grip, {
			axis: 'x',
			// The panel is right of its divider: pulling left makes it wider.
			sign: -1,
			from: () => panel.offsetWidth,
			to: (width) => {
				const style = getComputedStyle(panel);
				panel.style.width = `${clampSize(
					width,
					parseFloat(style.minWidth) || 240,
					parseFloat(style.maxWidth) || window.innerWidth,
				)}px`;
			},
		});
	}
	import Avatar from '$lib/components/Avatar.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import RiderVolume from '$lib/room/RiderVolume.svelte';
	import { rosterGroups } from '$lib/room/roster';
	import type { RoomMember, RoomRider } from '$lib/room/view';

	// The room's people and the room's talk, in one column (ADR-0020). Discord's
	// right column is WHO IS HERE; ours was chat alone, so the roster was
	// legible only from tiles that vanish behind the stage.
	//
	// Stacked rather than tabbed: the roster has to be there without being
	// asked for — that is the whole "this room is populated" read — and giving
	// members a column of their own took content to 530 px at 1280, which the
	// tile grid does not survive.
	//
	// Plus one slot: the jukebox playlist owns the whole queue surface (#286).
	//
	// The log itself left for the Chat place (#504, mock A): three surfaces
	// were sharing this height and none of them had enough. What stays behind
	// is one line saying what you missed.
	let {
		live,
		riders = [],
		members = [],
		player,
		missed = null,
		onOpenChat,
		onCheer,
		onPoke,
		cheers = STOCK_CHEERS,
	}: {
		live: boolean;
		/** Who is here (ADR-0020, #181 gap 3) — the roster owns the column. */
		riders?: RoomRider[];
		/**
		 * Everyone in the room, connected or not. The tick's roster carries no
		 * avatar and knows nothing of the members who are away, so the faces and
		 * the offline group both come from here.
		 */
		members?: RoomMember[];
		/** The jukebox playlist renders into the panel's top slot. */
		player?: Snippet;
		/** What was said while you were elsewhere; null when nothing was. */
		missed?: Missed | null;
		onOpenChat?: () => void;
		onCheer?: (emoji: string) => void;
		onPoke?: (id: string) => void;
		/** The room's one reaction vocabulary (#223), icon keys (#447). */
		cheers?: string[];
	} = $props();

	const avatarOf = $derived(new Map(members.map((m) => [m.id, m])));
	// Discord's offline half of the member list: the room is the same room when
	// nobody is in it, and a column that says "in the room — 1" and stops there
	// hides the six people you ride with (roster.ts).
	const groups = $derived(rosterGroups(live, riders, members));
</script>

{#snippet person(rider: RoomRider)}
	<!-- 44 px rows (#463): the speaker at the end is tapped from a bike, and
	     the slider it opens wraps onto a line of its own under the name. -->
	<li
		class="flex min-h-11 flex-wrap items-center gap-2 rounded px-2 py-1 text-xs {rider.speaking
			? 'text-ink'
			: 'text-ink/70'}"
		{@attach contextMenu(() =>
			rider.you
				? []
				: personMenu(rider.id, goto, {
						poke: onPoke ? { onSelect: () => onPoke(rider.id) } : undefined,
					}),
		)}
	>
		<!-- Opening a rider was right-click only here, while the members list,
		     the friends list and DM heads all linked to the page (#702) —
		     ux.md: the primary action stays on click, nothing lives ONLY in a
		     menu. The link takes the face and the name, not the row: the row
		     ends in RiderVolume, and a slider cannot sit inside an anchor. -->
		<a
			href="/u/{rider.id}"
			class="-my-1 flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-2 py-1"
			title="{rider.name} — open their page"
		>
			<span class="relative shrink-0">
				<Avatar
					name={rider.name}
					avatarUrl={avatarOf.get(rider.id)?.avatarUrl}
					preset={avatarOf.get(rider.id)?.avatarPreset}
					xp={avatarOf.get(rider.id)?.totalXp}
					size={22}
				/>
				{#if rider.watts > 0}
					<!-- Riding is motion, not a red-adjacent dot (ADR-0020). -->
					<span
						class="bg-surface ring-surface absolute -right-1 -bottom-1 rounded-full px-0.5 py-px ring-2"
					>
						<RidingBars size={8} />
					</span>
				{:else}
					<span
						class="bg-z4 ring-surface absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ring-2"
					></span>
				{/if}
			</span>
			<span class="min-w-0 flex-1">
				<span class="flex items-center gap-1.5">
					<span
						class="min-w-0 flex-1 truncate {rider.speaking
							? 'font-medium'
							: ''}">{rider.name}</span
					>
					{#if rider.coach}<Crown size={11} class="text-muted shrink-0" />{/if}
					{#if rider.cameraOn}<Video
							size={11}
							class="text-muted shrink-0"
						/>{/if}
					{#if rider.speaking}
						<Mic size={11} class="text-z4 shrink-0 animate-pulse" />
					{:else if rider.muted}
						<MicOff size={11} class="text-muted/50 shrink-0" />
					{/if}
					{#if live && rider.watts > 0}
						<span class="text-muted shrink-0 text-[10px] tabular-nums"
							>{Math.round(rider.execution * 100)}%</span
						>
					{/if}
				</span>
				{#if live && rider.watts > 0}
					<!-- Execution moved off the training surface (ADR-0020): how well
				     everyone is holding target is roster data, and this is the
				     roster. It also gives the column a job mid-ride, when nobody
				     is typing. -->
					<span class="mt-1 block">
						<ProgressBar
							pct={rider.execution * 100}
							h="h-1"
							fill={rider.you ? 'bg-watt' : 'bg-neon/70'}
							title="{rider.name} is holding target {Math.round(
								rider.execution * 100,
							)}% of the time"
						/>
					</span>
				{/if}
			</span>
		</a>
		{#if rider.inVoice && !rider.you}
			<RiderVolume id={rider.id} name={rider.name} />
		{/if}
	</li>
{/snippet}

{#snippet absent(member: RoomMember)}
	<li
		class="text-ink/35 flex min-h-11 items-center gap-2 rounded px-2 py-1 text-xs"
		{@attach contextMenu(() =>
			personMenu(member.id, goto, {
				poke: onPoke
					? {
							onSelect: () => onPoke(member.id),
							disabled: true,
							hint: 'not in the room',
						}
					: undefined,
			}),
		)}
	>
		<a
			href="/u/{member.id}"
			class="-my-1 flex min-h-11 min-w-0 flex-1 items-center gap-2 py-1"
			title="{member.displayName} — open their page"
		>
			<span class="shrink-0 opacity-50">
				<Avatar
					name={member.displayName}
					avatarUrl={member.avatarUrl}
					preset={member.avatarPreset}
					xp={member.totalXp}
					size={22}
				/>
			</span>
			<span class="min-w-0 flex-1 truncate">{member.displayName}</span>
		</a>
	</li>
{/snippet}

<!-- Resizable (#280) from its left edge. The browser's own `resize` grip is a
     corner of diagonal lines that belongs to no design; this is a 6 px strip
     on the border that lights up on hover and drags. keepSize persists the
     width it sets, the same way it did for the native grip. -->
<aside
	{@attach (node) => keepSize(node, 'side-panel')}
	class="border-ink/5 relative h-full w-80 shrink-0 overflow-hidden border-l"
	style="min-width: 240px; max-width: 40vw"
>
	<div
		{@attach edgeResize}
		class="hover:bg-neon/40 active:bg-neon/60 absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none transition-colors"
		role="separator"
		aria-orientation="vertical"
		aria-label="resize the panel"
	></div>
	<div class="flex h-full flex-col">
		{#if riders.length > 0 || groups.offline.length > 0}
			<!-- Everyone the room HAS, in the three groups roster.ts decides. The
			     headings say which question the split answers, and the ones who
			     are not connected sit last, greyed. -->
			{@const { here, away, offline } = groups}
			<div class="border-ink/5 min-h-0 flex-1 overflow-y-auto border-b">
				{#if here.length > 0}
					<div class="eyebrow flex items-center gap-1.5 px-3 pt-3 pb-1">
						{#if !live}<Headphones size={10} />{/if}
						{live
							? `holding target — ${here.length}`
							: `in voice — ${here.length}`}
					</div>
					<ul class="px-1">
						{#each here as rider (rider.id)}{@render person(rider)}{/each}
					</ul>
				{/if}
				{#if away.length > 0}
					<div class="eyebrow px-3 pt-3 pb-1">
						{live
							? `not pedalling — ${away.length}`
							: `in the room — ${away.length}`}
					</div>
					<ul class="px-1">
						{#each away as rider (rider.id)}{@render person(rider)}{/each}
					</ul>
				{/if}
				{#if offline.length > 0}
					<div class="eyebrow px-3 pt-3 pb-1">offline — {offline.length}</div>
					<ul class="px-1 pb-2">
						{#each offline as member (member.id)}{@render absent(member)}{/each}
					</ul>
				{/if}
			</div>
		{/if}
		{#if player}
			<!-- The deck, capped: with a seated player plus queue and history it
			     grew until the chat was a sliver (#461). Its own scroll past 45%.
			     The cap is never tighter than the transport row — a deck shorter
			     than its own controls scrolls the play button off the bottom,
			     which is what the 160 px cap did whenever the stage held the
			     video. -->
			<div
				class="border-ink/5 max-h-[45%] min-h-0 shrink-0 overflow-y-auto border-b p-4"
			>
				{@render player()}
			</div>
		{/if}

		{#if missed}
			<!-- What the chat left behind (#504, mock A): one line of what was
			     said while you were elsewhere, and the way to the rest of it.
			     Quiet — the count is chrome, and chrome does not glow. -->
			<button
				onclick={onOpenChat}
				class="border-ink/5 bg-surface-raised hover:bg-surface-raised/70 flex shrink-0 items-center gap-2 border-t px-3 py-3 text-left"
			>
				<span class="bg-neon h-2 w-2 shrink-0 rounded-full"></span>
				<span class="min-w-0 flex-1 truncate text-xs"
					><span class="text-muted">{missed.from}:</span>
					{missed.preview}</span
				>
				<span class="text-muted shrink-0 text-[10px]">{missed.count} new</span>
				<ChevronRight size={13} class="text-muted shrink-0" />
			</button>
		{/if}
		<div class="border-ink/5 border-t p-3">
			<!-- The room's reactions. Typing lives on the Chat place now, and
			     mid-ride it was never on the table anyway (ux.md). -->
			<div class="flex gap-1.5">
				{#each cheers.slice(0, 4) as cheer (cheer)}
					<button
						onclick={() => onCheer?.(cheer)}
						aria-label={cheer}
						title={cheer}
						class="border-muted/20 hover:border-muted/50 flex flex-1 items-center justify-center rounded border py-2"
						><CheerIcon {cheer} size={18} /></button
					>
				{/each}
			</div>
		</div>
	</div>
</aside>
