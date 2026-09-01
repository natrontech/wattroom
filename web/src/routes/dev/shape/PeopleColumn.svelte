<script lang="ts">
	// The room's people and the room's talk, in ONE column (ADR-0020, #181 gap
	// 3). Discord's right column is WHO IS HERE; ours was chat alone, so the
	// roster was legible only from tiles that vanish behind the stage.
	//
	// Stacked rather than tabbed or split: the roster has to be there without
	// being asked for — that is the whole "this room is populated" read — and
	// members as a column of their own took content down to 530 px at 1280 px,
	// which the tile grid does not survive. Both alternatives were mocked and
	// dropped; the reasoning is ADR-0020's, the markup is in git.
	import Avatar from '$lib/components/Avatar.svelte';
	import RidingBars from './RidingBars.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import type { RoomRider } from '$lib/room/view';
	import { Crown, Headphones, Mic, MicOff, Video } from '@lucide/svelte';

	let {
		riders,
		speakingName = '',
		live = false,
	}: {
		riders: RoomRider[];
		speakingName?: string;
		/** A session is running — the roster carries execution instead of chatter. */
		live?: boolean;
	} = $props();

	// Mid-ride the useful split is riding / not; in the lounge it is voice /
	// not. Same column, and the heading says which question it is answering —
	// grouping by mic put a pedalling rider under "in the room".
	const here = $derived(
		live ? riders.filter((r) => r.watts > 0) : riders.filter((r) => !r.muted),
	);
	const away = $derived(riders.filter((r) => !here.includes(r)));

	const chat = [
		{
			who: 'Nina',
			at: '19:58',
			text: 'ftp test next week or are we all cowards',
		},
		{ who: 'Ruben', at: '19:58', text: 'cowards' },
		{ who: 'Milo', at: '20:01', text: 'my trainer is making a noise again' },
		{ who: 'Sara', at: '20:01', text: 'thats just your knees milo' },
	];
	const events = [
		{ at: '20:03', text: 'Nina started Sweet Spot 2×20' },
		{ at: '20:07', text: 'Tobi queued Kavinsky — Nightcall' },
	];
</script>

{#snippet person(rider: RoomRider)}
	{@const talking = rider.name === speakingName && !rider.muted}
	<li
		class="flex items-center gap-2 rounded px-2 py-1 text-xs {talking
			? 'text-ink'
			: 'text-ink/70'}"
	>
		<span class="relative shrink-0">
			<Avatar name={rider.name} size={22} />
			{#if rider.watts > 0}
				<!-- Riding is motion, not a red-adjacent dot. -->
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
				<span class="min-w-0 flex-1 truncate {talking ? 'font-medium' : ''}"
					>{rider.name}</span
				>
				{#if rider.coach}<Crown size={11} class="text-muted shrink-0" />{/if}
				{#if rider.cameraOn}<Video size={11} class="text-muted shrink-0" />{/if}
				{#if talking}
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
				     everyone is holding target is roster data, and the roster is
				     here. It also gives this column a job mid-ride, when nobody
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
	</li>
{/snippet}

{#snippet roster()}
	<div
		class="min-h-0 shrink-0 overflow-y-auto {live ? 'max-h-none' : 'max-h-56'}"
	>
		<div class="eyebrow flex items-center gap-1.5 px-3 pt-3 pb-1">
			{#if !live}<Headphones size={10} />{/if}
			{live ? `holding target — ${here.length}` : `in voice — ${here.length}`}
		</div>
		<ul class="px-1">
			{#each here as rider (rider.id)}{@render person(rider)}{/each}
		</ul>
		{#if away.length}
			<div class="eyebrow px-3 pt-3 pb-1">
				{live
					? `not pedalling — ${away.length}`
					: `in the room — ${away.length}`}
			</div>
			<ul class="px-1">
				{#each away as rider (rider.id)}{@render person(rider)}{/each}
			</ul>
		{/if}
	</div>
{/snippet}

{#snippet talk()}
	<div class="flex min-h-0 flex-1 flex-col">
		<div class="eyebrow px-3 pt-3 pb-1">chat</div>
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-1">
			<ul class="mt-auto space-y-2">
				{#each chat as line (line.text)}
					<li class="text-xs leading-snug">
						<span class="flex items-baseline gap-1.5">
							<span class="text-muted truncate font-medium">{line.who}</span>
							<span class="text-muted/40 font-mono text-[10px]">{line.at}</span>
						</span>
						<span class="text-ink/85 wrap-anywhere">{line.text}</span>
					</li>
				{/each}
				{#each events as event (event.text)}
					<li
						class="text-muted/60 flex items-baseline gap-1.5 text-[11px] leading-snug"
					>
						<span class="min-w-0 wrap-anywhere">{event.text}</span>
						<span class="text-muted/40 ml-auto font-mono text-[10px]"
							>{event.at}</span
						>
					</li>
				{/each}
			</ul>
		</div>
		<div class="border-ink/5 border-t p-2.5">
			<input placeholder="Say something…" class="input input-xs w-full" />
			<div class="mt-2 flex gap-1.5">
				{#each ['🔥', '💪', '😤', '🚀'] as emoji (emoji)}
					<button
						class="border-muted/20 hover:border-muted/50 flex-1 rounded border py-2 text-base"
						>{emoji}</button
					>
				{/each}
			</div>
		</div>
	</div>
{/snippet}

<aside class="border-ink/5 flex h-full w-68 shrink-0 flex-col border-l">
	{@render roster()}
	<div class="border-ink/5 border-t"></div>
	{@render talk()}
</aside>
