<script lang="ts">
	// MOCK (#1023): one 240 px sidebar, drawn in whichever of the three shapes
	// is asked for. Same data, same tokens, same width as the real thing —
	// the options are only comparable at true size.
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import { UNREAD_COUNT, unreadCount } from '$lib/messages/unread-marks';
	import { roomPlaces } from '$lib/nav/pages';
	import {
		crewPulse,
		crews,
		openRoom,
		type MockCrew,
		type MockRoom,
	} from './data';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import Eye from '@lucide/svelte/icons/eye';
	import Headphones from '@lucide/svelte/icons/headphones';
	import Lock from '@lucide/svelte/icons/lock';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';

	let { shape }: { shape: 'indent' | 'rail' | 'switcher' } = $props();

	// C is only judgeable if the crew actually changes, and A only if a crew
	// collapses — a shape that cannot be operated cannot be argued with.
	let current = $state('natron');
	let collapsed = $state<string[]>([]);
	const crew = $derived(crews.find((c) => c.slug === current) ?? crews[0]);
	// The room you are standing in belongs to one crew, and C lets you look at
	// another. Without this it drops out of the sidebar mid-session and folds
	// Training two clicks away — the exact rider report #416 fixed, and the
	// opposite of ADR-0020's "places are permanent and beside the content".
	// So C only works pinned, and the pin is part of the option, not a polish.
	const standing = $derived(
		crews.find((c) => c.rooms.some((r) => r.slug === openRoom))!,
	);
	const elsewhere = $derived(
		shape === 'switcher' && crew.slug !== standing.slug,
	);
</script>

{#snippet accessMark(room: MockRoom)}
	{#if room.access === 'locked'}
		<Lock size={11} class="text-muted/60 shrink-0" />
	{:else if room.access === 'admin'}
		<SlidersHorizontal size={11} class="text-muted/60 shrink-0" />
	{:else if room.access === 'private'}
		<Eye size={11} class="text-muted/60 shrink-0" />
	{/if}
{/snippet}

{#snippet roomRow(room: MockRoom, indent: string)}
	{@const open = room.slug === openRoom}
	{@const reachable = room.access !== 'locked' && room.access !== 'admin'}
	<li class="rounded-md {open ? 'bg-ink/5' : ''}">
		<div
			class="block rounded px-2 pt-1.5 {room.voice?.length
				? 'pb-0'
				: 'pb-1.5'} {indent}
				{open ? 'text-ink' : reachable ? 'text-muted/70' : 'text-muted/45'}"
		>
			<span class="flex items-center gap-2">
				<RoomIcon icon={room.icon} size={14} />
				<span
					class="truncate {open
						? 'font-display text-ink text-base font-semibold'
						: room.unread
							? 'text-ink/80 text-sm font-medium'
							: 'text-sm'}">{room.name}</span
				>
				{@render accessMark(room)}
				{#if room.unread}
					<span class="{UNREAD_COUNT} ml-auto">{unreadCount(room.unread)}</span>
				{:else if room.connected}
					<span class="ml-auto flex shrink-0 items-center gap-1">
						<span class="bg-z4 h-1.5 w-1.5 rounded-full"></span>
						<span class="text-muted/70 font-mono text-[10px]"
							>{room.connected}</span
						>
					</span>
				{:else}
					<span class="text-muted/50 ml-auto shrink-0 font-mono text-[10px]"
						>{room.members}</span
					>
				{/if}
			</span>
			{#if room.session}
				<span
					class="text-watt/90 mt-0.5 flex items-center gap-1.5 truncate text-[10px]"
				>
					<RidingBars size={9} />
					{room.session.workoutName} · {Math.round(
						room.session.elapsedSec / 60,
					)} min in
				</span>
			{:else if room.next}
				<span class="text-muted/70 mt-0.5 block truncate text-[10px]"
					>next: {room.next}</span
				>
			{/if}
		</div>
		{#if room.voice?.length}
			<div
				class="text-muted/80 flex items-center gap-1 rounded px-2 pt-1 pb-1.5 text-[10px] {indent}"
			>
				<Headphones size={9} class="shrink-0" />
				<span class="truncate">{room.voice.join(', ')}</span>
			</div>
		{/if}
		{#if open}
			<ul
				class="mt-0.5 mr-2 mb-1 space-y-0.5 pb-1.5 {shape === 'indent'
					? 'ml-7'
					: 'ml-4'}"
			>
				{#each roomPlaces as entry (entry.path)}
					{@const on = entry.path === '/training'}
					<li>
						<span
							class="flex items-center gap-2 rounded px-2 py-1.5 text-[13px] {on
								? 'bg-ink/10 text-ink'
								: 'text-muted'}"
						>
							<entry.icon size={14} class="shrink-0" />
							<span class="truncate">{entry.label}</span>
							{#if on}<span class="ml-auto"><RidingBars size={10} /></span>{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

{#snippet crewGroup(c: MockCrew)}
	{@const shut = collapsed.includes(c.slug)}
	{@const pulse = crewPulse(c)}
	<li>
		<button
			onclick={() =>
				(collapsed = shut
					? collapsed.filter((s) => s !== c.slug)
					: [...collapsed, c.slug])}
			class="text-muted hover:text-ink flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left"
		>
			<ChevronDown
				size={12}
				class="shrink-0 transition-transform {shut ? '-rotate-90' : ''}"
			/>
			<RoomIcon icon={c.icon} size={13} />
			<span
				class="font-display truncate text-[13px] font-semibold tracking-wide uppercase"
				>{c.name}</span
			>
			<!-- A collapsed crew still has to answer "where is everyone" (#1023).
			     The pulse is the sum of what its rooms are doing. -->
			{#if shut && (pulse.riding || pulse.voice || pulse.unread)}
				<span class="ml-auto flex shrink-0 items-center gap-1.5">
					{#if pulse.riding}<span
							class="text-watt/90 flex items-center gap-1 text-[10px]"
							><RidingBars size={8} />{pulse.riding}</span
						>{/if}
					{#if pulse.voice}<span
							class="text-muted/70 flex items-center gap-0.5 text-[10px]"
							><Headphones size={9} />{pulse.voice}</span
						>{/if}
					{#if pulse.unread}<span class={UNREAD_COUNT}
							>{unreadCount(pulse.unread)}</span
						>{/if}
				</span>
			{/if}
		</button>
		{#if !shut}
			<ul class="space-y-0.5">
				{#each c.rooms as room (room.slug)}
					{@render roomRow(room, 'ml-3')}
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<div
	class="bg-surface border-ink/5 flex h-[560px] w-60 shrink-0 flex-col rounded-lg border"
>
	{#if shape === 'switcher'}
		<!-- The crew is a mode, not a level: the column below keeps exactly the
		     two-deep shape ADR-0020 sized for. -->
		<button
			onclick={() =>
				(current =
					crews[(crews.findIndex((c) => c.slug === current) + 1) % crews.length]
						.slug)}
			class="border-ink/5 hover:bg-ink/5 flex w-full items-center gap-2 border-b px-3 py-3 text-left"
		>
			<RoomIcon icon={crew.icon} size={16} />
			<span class="font-display truncate text-sm font-bold">{crew.name}</span>
			<ChevronsUpDown size={14} class="text-muted ml-auto shrink-0" />
		</button>
		<!-- What the other crews are doing while you are not looking at them —
		     the cost this shape has to pay back. -->
		<div class="border-ink/5 flex items-center gap-2 border-b px-3 py-1.5">
			{#each crews.filter((c) => c.slug !== current) as other (other.slug)}
				{@const pulse = crewPulse(other)}
				<button
					onclick={() => (current = other.slug)}
					title="{other.name} — {pulse.riding} riding, {pulse.voice} in voice, {pulse.unread} new"
					aria-label="{other.name} — {pulse.riding} riding, {pulse.voice} in voice, {pulse.unread} new"
					class="hover:text-ink text-muted/70 flex items-center gap-1 text-[10px]"
				>
					<RoomIcon icon={other.icon} size={12} />
					{#if pulse.riding}<span class="text-watt/90 flex items-center gap-0.5"
							><RidingBars size={8} />{pulse.riding}</span
						>{/if}
					{#if pulse.unread}<span class={UNREAD_COUNT}
							>{unreadCount(pulse.unread)}</span
						>{/if}
				</button>
			{/each}
		</div>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
		{#if shape === 'indent'}
			<div class="eyebrow px-2 pt-1 pb-1">your crews</div>
			<ul class="space-y-1">
				{#each crews as c (c.slug)}
					{@render crewGroup(c)}
				{/each}
			</ul>
		{:else}
			{#if elsewhere}
				{@const room = standing.rooms.find((r) => r.slug === openRoom)!}
				<div class="eyebrow px-2 pt-1 pb-1">you are in · {standing.name}</div>
				<ul class="border-ink/5 mb-2 space-y-0.5 border-b pb-2">
					{@render roomRow(room, '')}
				</ul>
			{/if}
			<div class="eyebrow px-2 pt-1 pb-1">
				{shape === 'rail' ? crew.name : 'rooms'}
			</div>
			<ul class="space-y-0.5">
				{#each crew.rooms as room (room.slug)}
					{@render roomRow(room, '')}
				{/each}
			</ul>
		{/if}
	</div>
</div>

{#if shape === 'rail'}
	<!-- Discord's second column, literally — the shape ADR-0020 rejected on
	     sight for rooms. Drawn so the re-argument has something to look at. -->
	<div
		class="bg-surface-raised border-ink/5 order-first flex h-[560px] w-12 shrink-0 flex-col items-center gap-1 rounded-lg border py-2"
	>
		{#each crews as c (c.slug)}
			{@const pulse = crewPulse(c)}
			<button
				onclick={() => (current = c.slug)}
				title={c.name}
				aria-label={c.name}
				class="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg {c.slug ===
				current
					? 'bg-ink/10 text-ink'
					: 'text-muted/70 hover:bg-ink/5'}"
			>
				<RoomIcon icon={c.icon} size={18} />
				{#if pulse.riding}
					<span
						class="bg-watt absolute right-1 bottom-1 h-1.5 w-1.5 rounded-full"
					></span>
				{:else if pulse.unread}
					<span
						class="bg-muted absolute right-1 bottom-1 h-1.5 w-1.5 rounded-full"
					></span>
				{/if}
			</button>
		{/each}
	</div>
{/if}
