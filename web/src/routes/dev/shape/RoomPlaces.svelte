<script lang="ts">
	// Column 3 while you are standing in a room. Every one of these was a tab,
	// a modal or a separate route before ADR-0020; here each is a place with a
	// URL, and the content column starts with the work instead of a header
	// repeating the room name column 2 already carries.
	import Avatar from '$lib/components/Avatar.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import RidingBars from './RidingBars.svelte';
	import RiderTile from '$lib/room/RiderTile.svelte';
	import ZoneBar from '$lib/components/ZoneBar.svelte';
	import { formatClock, wkg } from '$lib/format';
	import {
		fillPct,
		plannedZoneSeconds,
		ZONE_BG,
		ZONE_TEXT,
		zoneOf,
	} from '$lib/components/zones';
	import type { Segment } from '$lib/workout/types';
	import { targetState, type Block, type RoomRider } from '$lib/room/view';
	import {
		CalendarClock,
		Crown,
		MonitorUp,
		Plus,
		Radio,
		ScreenShare,
	} from '@lucide/svelte';

	let {
		screen,
		riders,
		segments,
		total,
		elapsed,
		block,
		bias,
		countdown = 10,
	}: {
		screen: string;
		riders: RoomRider[];
		segments: Segment[];
		total: number;
		elapsed: number;
		block: Block | null;
		bias: number;
		countdown?: number;
	} = $props();

	const you = $derived(riders.find((r) => r.you)!);
	const others = $derived(riders.filter((r) => !r.you));
	const zoneSeconds = $derived(plannedZoneSeconds(segments, you?.ftp ?? 265));

	const upcoming = [
		{
			name: 'Sweet Spot 2×20',
			when: 'Thu 20:00 · in 2 days',
			minutes: 65,
			by: 'Nina',
		},
		{
			name: 'VO₂ 5×3',
			when: 'Sun 09:30 · in 5 days',
			minutes: 48,
			by: 'Ruben',
		},
	];
	const members = [
		{ name: 'Nina', role: 'owner', ftp: 240, joined: 'Aug 2026', medals: 4 },
		{ name: 'Ruben', role: 'coach', ftp: 310, joined: 'Aug 2026', medals: 2 },
		{ name: 'You', role: 'member', ftp: 265, joined: 'Aug 2026', medals: 3 },
		{ name: 'Sara', role: 'member', ftp: 285, joined: 'Sep 2026', medals: 1 },
		{ name: 'Milo', role: 'member', ftp: 195, joined: 'Sep 2026', medals: 0 },
		{ name: 'Tobi', role: 'member', ftp: 225, joined: 'Sep 2026', medals: 0 },
	];
</script>

{#if screen === 'room-lounge' || screen === 'room-focus' || screen === 'room-stage'}
	<div class="flex h-full flex-col overflow-y-auto px-5 py-4">
		<!-- No page header. Column 2 says which room this is, column 4 says who
		     is in it — a header would be the third thing repeating it. What is
		     left is the one row of things the lounge can DO. -->
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<button class="btn btn-accent btn-lg"
				><Radio size={15} /> Start a session</button
			>
			<button class="btn btn-secondary"
				><ScreenShare size={14} /> Share screen</button
			>
			<button class="btn btn-ghost btn-xs ml-auto"
				><MonitorUp size={13} /> TV</button
			>
		</div>

		{#if screen === 'room-stage'}
			<!-- What "media-focus" used to be a whole layout for. RMF: nothing is
			     ever overlaid on the player, so the controls sit under it. -->
			<div
				class="border-neon/30 bg-paper relative mb-3 aspect-video w-full shrink-0 overflow-hidden rounded-lg border"
			>
				<div
					class="h-full w-full"
					style="background: radial-gradient(120% 90% at 30% 20%, oklch(0.42 0.16 300), oklch(0.16 0.06 300))"
				></div>
				<span
					class="bg-surface/85 absolute bottom-2 left-2 rounded px-2 py-1 text-[11px]"
					>Ruben's screen</span
				>
			</div>
			<div class="mb-3 flex gap-2">
				{#each ['Ruben · screen', 'Nina · camera', 'Jukebox'] as source, i (source)}
					<button
						class="rounded border px-2.5 py-1 text-[11px] {i === 0
							? 'border-neon text-ink'
							: 'border-muted/20 text-muted'}">{source}</button
					>
				{/each}
			</div>
		{/if}

		{#if screen === 'room-focus'}
			<!-- What "video-first" used to be a whole layout for: one rider,
			     bigger. A tap, not a mode you have to remember you are in.
			     `stretch` is deliberately NOT used — it sets h-full, which needs a
			     parent with a height, and in a width-constrained box it collapses
			     the tile to nothing. aspect-video is what a focused tile wants. -->
			{@const focused = others[1]}
			<div
				class="grid min-h-0 shrink-0 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]"
			>
				<div>
					<RiderTile rider={focused} phase="lounge" />
					<p class="text-muted mt-2 text-xs">
						<span class="text-ink font-medium">{focused.name}</span> is focused —
						tap their tile again to let go.
					</p>
				</div>
				<!-- Everyone else stays visible beside them, small. Focus narrows
				     what you are looking at; it does not empty the room. -->
				<div class="grid grid-cols-3 gap-2 lg:grid-cols-1">
					{#each riders.filter((r) => r.id !== focused.id) as rider (rider.id)}
						<RiderTile {rider} phase="lounge" />
					{/each}
				</div>
			</div>
		{:else}
			<!-- One fused grid: camera and metrics on the same tile (#181). -->
			<div class="grid shrink-0 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
				{#each riders as rider (rider.id)}
					<RiderTile {rider} phase="lounge" />
				{/each}
			</div>
		{/if}

		<p class="text-muted/70 mt-4 text-[11px]">
			Nothing is running. The room is a place to be — the session starts when
			someone starts it.
		</p>
	</div>
{:else if screen === 'room-countdown'}
	<div class="grid h-full place-items-center">
		<div class="text-center">
			<p class="eyebrow">starting</p>
			<p
				class="font-display text-watt glow-text-strong text-[10rem] leading-none font-bold tabular-nums"
			>
				{countdown}
			</p>
			<p class="font-display mt-4 text-2xl font-bold">Sweet Spot 2×20</p>
			<p class="text-muted mt-1 text-sm">
				65 min · {riders.length} riders · Nina is coaching
			</p>
		</div>
	</div>
{:else if screen === 'room-training' || screen === 'room-training-media'}
	<!-- The 3 m surface, built backwards from one question — am I on target —
	     and one fact this app exists for: you are not riding alone.
	
	     A FOCUS SLOT, not a fixed layout. Normally the focus is your own
	     instrument. The moment someone shares a screen or the jukebox plays a
	     video, that takes the focus and the instrument collapses to a bar
	     underneath it — never on top: RMF forbids anything overlaid on the
	     player, so the numbers go below rather than over. That is the same
	     "media-focus layout" WATTROOM.md used to make you pick from a menu,
	     except the room picks it for you when there is media to show.
	
	     Under the focus, always, the CREW: a camera thumb and live numbers for
	     everyone. The previous pass showed your own watts and nothing else,
	     which turned group training into solo training with a chat window. -->
	{@const media = screen === 'room-training-media'}
	{@const pct = (w: number) => fillPct(w, you.ftp)}
	{@const state = targetState(you)}
	<div
		class="grid h-full min-h-0 grid-rows-[auto_1fr_auto_auto] overflow-hidden"
	>
		<header class="flex items-end gap-6 px-6 pt-5 pb-4">
			<div class="min-w-0">
				<p class="eyebrow">block {block?.index ?? 1} of {block?.count ?? 6}</p>
				<h2 class="font-display truncate text-3xl leading-none font-bold">
					{block?.label ?? 'Warm-up'}
				</h2>
			</div>
			<div class="shrink-0">
				<p class="eyebrow">left in block</p>
				<p class="font-display text-3xl leading-none font-bold tabular-nums">
					{formatClock(block?.secondsLeft ?? 0)}
				</p>
			</div>
			{#if block?.next}
				<p class="text-muted min-w-0 truncate text-xs">
					next · {block.next.label}
					{block.next.watts} W for {Math.round(block.next.seconds / 60)} min
				</p>
			{/if}
			<p class="text-muted ml-auto shrink-0 text-sm tabular-nums">
				{formatClock(elapsed)}
				<span class="text-muted/50">/ {formatClock(total)}</span>
			</p>
		</header>

		<!-- The focus. -->
		{#if media}
			<section class="grid min-h-0 place-items-center px-6">
				<div
					class="ring-neon/30 relative aspect-video max-h-full w-full overflow-hidden rounded-lg ring-1"
				>
					<div
						class="h-full w-full"
						style="background: radial-gradient(120% 90% at 30% 20%, oklch(0.42 0.16 300), oklch(0.14 0.05 300))"
					></div>
				</div>
			</section>
		{:else}
			<section class="grid min-h-0 content-center px-6">
				<div class="relative h-28">
					<!-- The needle: your number travels with your power, so "left or
					     right of the bright slot" reads before any digit does.
					     clamp() keeps it on screen at 0 W and at a sprint. -->
					<div
						class="absolute bottom-0 -translate-x-1/2 text-center transition-[left] duration-500 ease-out"
						style="left: clamp(5rem, {pct(you.watts)}%, calc(100% - 5rem))"
					>
						<span
							class="font-display text-watt glow-text-strong block text-[6.5rem] leading-[0.85] font-bold tabular-nums"
							>{you.watts}</span
						>
						<span class="eyebrow">watts</span>
					</div>
				</div>

				<div class="relative mt-3 h-12">
					<div
						class="bg-surface-raised absolute inset-0 overflow-hidden rounded-full"
					>
						{#if state.has}
							<div
								class="bg-neon/30 absolute inset-y-0"
								style="left: {pct(you.target - state.band)}%; width: {pct(
									you.target + state.band,
								) - pct(you.target - state.band)}%"
							></div>
						{/if}
						<!-- Literal zone class — Tailwind scans source text, so a
						     composed `bg-z3/60` is never generated (zones.ts). Full
						     strength: the ramp is contrast-gated at 3:1. -->
						<div
							class="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
							style="width: {pct(you.watts)}%"
						>
							<div
								class="{ZONE_BG[zoneOf(you.watts, you.ftp)]} h-full w-full"
							></div>
						</div>
						{#if state.has}
							<div
								class="bg-neon absolute inset-y-0 w-1"
								style="left: {pct(you.target)}%"
							></div>
						{/if}
					</div>
				</div>

				<div class="text-muted mt-2 flex items-baseline text-xs tabular-nums">
					<span>0</span>
					<span
						class="mx-auto text-sm {state.inBand
							? 'text-z4'
							: state.delta > 0
								? 'text-z5'
								: 'text-muted'}"
					>
						{#if !state.has}
							no target — spin easy
						{:else if state.inBand}
							on target · {you.target} W
						{:else}
							{state.delta > 0 ? '+' : ''}{state.delta} W · aim for {you.target}
						{/if}
					</span>
					<span>{Math.round(you.ftp * 1.5)}</span>
				</div>
			</section>
		{/if}

		<!-- Your numbers. Full row normally; a single compact bar under the
		     player when media has the focus — below it, never over it (RMF). -->
		<div class="mt-4 flex items-center gap-6 px-6">
			{#if media}
				<span class="flex shrink-0 items-baseline gap-1.5">
					<span
						class="font-display text-watt glow-text-strong text-4xl leading-none font-bold tabular-nums"
						>{you.watts}</span
					>
					<span class="eyebrow">w</span>
				</span>
				<span class="relative h-3 min-w-0 flex-1">
					<span
						class="bg-surface-raised absolute inset-0 overflow-hidden rounded-full"
					>
						{#if state.has}
							<span
								class="bg-neon/30 absolute inset-y-0"
								style="left: {pct(you.target - state.band)}%; width: {pct(
									you.target + state.band,
								) - pct(you.target - state.band)}%"
							></span>
						{/if}
						<span
							class="absolute inset-y-0 left-0 transition-[width] duration-500"
							style="width: {pct(you.watts)}%"
						>
							<span
								class="{ZONE_BG[
									zoneOf(you.watts, you.ftp)
								]} block h-full w-full"
							></span>
						</span>
					</span>
				</span>
				<span
					class="shrink-0 text-xs tabular-nums {state.inBand
						? 'text-z4'
						: 'text-muted'}"
					>{state.has ? `target ${you.target} W` : 'no target'}</span
				>
			{/if}
			{#each [{ label: 'rpm', value: `${you.cadence}` }, { label: 'bpm', value: `${you.hr}` }, { label: 'w/kg', value: wkg(you.watts, you.kg) }] as stat (stat.label)}
				<div class="shrink-0">
					<span
						class="font-display block leading-none font-bold tabular-nums {media
							? 'text-lg'
							: 'text-2xl'}">{stat.value}</span
					>
					<span class="eyebrow">{stat.label}</span>
				</div>
			{/each}
			<!-- Bias is the one control reached for mid-interval, so it keeps
			     thumb-sized targets whatever else shrinks (ux.md). -->
			<div class="ml-auto flex shrink-0 items-center gap-2">
				<button
					class="border-muted/25 hover:border-muted/60 h-11 w-11 rounded-full border text-lg"
					aria-label="ease the target by one percent">−</button
				>
				<span class="text-center">
					<span
						class="font-display block text-lg leading-none font-bold tabular-nums"
						>{Math.round(bias * 100)}%</span
					>
					<span class="eyebrow">bias</span>
				</span>
				<button
					class="border-muted/25 hover:border-muted/60 h-11 w-11 rounded-full border text-lg"
					aria-label="raise the target by one percent">+</button
				>
			</div>
		</div>

		<!-- The crew. Camera thumb and live numbers for everyone — this is group
		     training, and without it the surface is a solo app with a chat. -->
		<div class="mt-4">
			<div class="flex gap-2 px-6">
				{#each riders.filter((r) => !r.you) as rider (rider.id)}
					{@const zone = zoneOf(rider.watts, rider.ftp)}
					<div class="min-w-0 flex-1">
						<div
							class="ring-ink/10 relative aspect-video overflow-hidden rounded ring-1"
						>
							{#if rider.cameraOn}
								<div
									class="h-full w-full"
									style="background: radial-gradient(120% 100% at 40% 20%, oklch(0.45 0.13 {rider.hue}), oklch(0.16 0.05 {rider.hue}))"
								></div>
							{:else}
								<div
									class="bg-surface-raised grid h-full w-full place-items-center"
								>
									{#if rider.watts > 0}<RidingBars size={16} />{/if}
								</div>
							{/if}
							<!-- Watts on the thumb: at 3 m the number has to be on the
							     face you are already looking at. -->
							<span
								class="from-paper/85 absolute inset-x-0 bottom-0 flex items-baseline gap-1 bg-gradient-to-t to-transparent px-1.5 pt-4 pb-1"
							>
								<span
									class="font-display {ZONE_TEXT[
										zone
									]} text-xl leading-none font-bold tabular-nums"
									>{rider.watts}</span
								>
								<span class="text-muted text-[9px]">W</span>
								<span class="text-muted ml-auto truncate text-[10px]"
									>{rider.name}</span
								>
							</span>
						</div>
						<p class="text-muted mt-1 truncate text-[10px] tabular-nums">
							{wkg(rider.watts, rider.kg)} w/kg · {rider.cadence} rpm · {rider.hr}
							bpm
						</p>
					</div>
				{/each}
			</div>

			{#if !media}
				<!-- The horizon. The session is the ground the numbers stand on,
				     not another card. It gives way to the player when media has
				     the focus — two grounds is one too many. -->
				<div class="mt-3 h-28">
					<IntervalGraph
						{segments}
						{total}
						{elapsed}
						ftp={you.ftp}
						trace={you.trace}
					/>
				</div>
			{/if}
		</div>
	</div>
{:else if screen === 'room-sessions'}
	<div class="mx-auto w-full max-w-3xl px-5 py-6">
		<div class="mb-5 flex items-center gap-3">
			<h2 class="font-display text-xl font-bold">What's planned here</h2>
			<button class="btn btn-primary btn-xs ml-auto"
				><Plus size={13} /> Plan a session</button
			>
		</div>
		<ul class="space-y-2">
			{#each upcoming as entry, i (entry.name)}
				<li
					class="panel flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 {i ===
					0
						? 'border-neon/40'
						: ''}"
				>
					<CalendarClock size={16} class="text-muted shrink-0" />
					<div class="min-w-0 flex-1">
						<p class="eyebrow">
							{i === 0 ? 'next session in this room' : 'after that'}
						</p>
						<p class="font-display truncate text-base font-bold">
							{entry.name}
						</p>
						<p class="text-muted mt-0.5 text-xs">
							{entry.when} · {entry.minutes} min · planned by {entry.by}
						</p>
					</div>
					<span class="flex shrink-0 gap-3">
						<button class="text-muted hover:text-ink text-[11px] underline"
							>move</button
						>
						<button class="text-muted hover:text-ink text-[11px] underline"
							>remove</button
						>
					</span>
				</li>
			{/each}
		</ul>
		<div class="border-ink/5 mt-4 flex flex-wrap gap-4 border-t pt-3">
			<button class="text-muted hover:text-ink text-[11px] underline"
				>subscribe to this room</button
			>
			<a
				href="#sessions"
				class="text-muted hover:text-ink text-[11px] underline"
				>all your sessions</a
			>
		</div>

		<h3 class="eyebrow mt-8">this month</h3>
		<div class="panel mt-2 grid grid-cols-3 gap-4 px-4 py-3">
			{#each [{ k: 'sessions', v: '7' }, { k: 'streak', v: '4 weeks' }, { k: 'work', v: '4 210 kJ' }] as stat (stat.k)}
				<div>
					<p class="eyebrow">{stat.k}</p>
					<p class="font-display text-xl font-bold tabular-nums">{stat.v}</p>
				</div>
			{/each}
		</div>
		<div class="mt-4">
			<p class="eyebrow mb-1.5">time in zone, if you ride what's planned</p>
			<ZoneBar seconds={zoneSeconds} legend />
		</div>
	</div>
{:else if screen === 'room-members'}
	<div class="mx-auto w-full max-w-3xl px-5 py-6">
		<h2 class="font-display mb-1 text-xl font-bold">
			Who rides here — {members.length}
		</h2>
		<p class="text-muted mb-5 text-xs">
			Column 4 is the live read; this is the paperwork — roles, medals, when
			they joined.
		</p>
		<ul class="divide-ink/5 panel divide-y">
			{#each members as member (member.name)}
				<li class="flex items-center gap-3 px-4 py-2.5">
					<Avatar name={member.name} size={32} />
					<span class="min-w-0 flex-1">
						<span class="flex items-center gap-1.5">
							<span class="truncate text-sm font-medium">{member.name}</span>
							{#if member.role === 'owner'}<Crown
									size={12}
									class="text-muted"
								/>{/if}
						</span>
						<span class="text-muted block text-[11px]"
							>{member.role} · {member.ftp} W · joined {member.joined}</span
						>
					</span>
					{#if member.medals > 0}
						<span class="text-muted shrink-0 text-xs tabular-nums"
							>🏅 {member.medals}</span
						>
					{/if}
					<button class="btn btn-ghost btn-xs shrink-0">Manage</button>
				</li>
			{/each}
		</ul>
	</div>
{:else if screen === 'room-settings'}
	<div class="mx-auto w-full max-w-2xl space-y-6 px-5 py-6">
		<div class="panel p-4">
			<label class="block">
				<span class="eyebrow">room name</span>
				<input class="input mt-1 w-full" value="Thursday Sufferfest" />
			</label>
			<label class="mt-3 block">
				<span class="eyebrow">room icon</span>
				<input class="input input-xs mt-1 w-20 text-center" value="🔥" />
			</label>
		</div>
		<div class="panel p-4">
			<h3 class="font-display font-bold">Sound pack</h3>
			<p class="text-muted mt-1 text-xs">
				What the room says out loud when a block changes.
			</p>
			<div class="mt-3 flex flex-wrap gap-2">
				{#each ['Base', 'Arcade', 'Quiet'] as pack, i (pack)}
					<button
						class="rounded border px-3 py-1.5 text-xs {i === 0
							? 'border-neon text-ink'
							: 'border-muted/20 text-muted'}">{pack}</button
					>
				{/each}
			</div>
		</div>
		<div class="panel p-4">
			<h3 class="font-display font-bold">Reactions</h3>
			<div class="mt-3 flex flex-wrap gap-1.5">
				{#each ['🔥', '💪', '😤', '🚀', '☠️', '🧊'] as emoji (emoji)}
					<span class="border-muted/20 rounded border px-2.5 py-1.5 text-base"
						>{emoji}</span
					>
				{/each}
			</div>
		</div>
		<div class="border-z6/40 rounded-lg border p-4">
			<h3 class="font-display text-z6 font-bold">Delete room</h3>
			<p class="text-muted mt-1 text-xs">
				Every ride recorded here stays on the riders' own history. The room, its
				medals and its plans do not.
			</p>
			<button class="btn btn-danger mt-3">Delete Thursday Sufferfest</button>
		</div>
	</div>
{/if}
