<script lang="ts">
	// The room's Sessions place (ADR-0020). Was a card wedged under the rider
	// tiles, visible only in the lounge; it has a URL now, and /sessions —
	// the cross-room list — folded into Home (#388).
	import WhenPicker from '$lib/components/WhenPicker.svelte';
	import ZoneBar from '$lib/components/ZoneBar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { plannedZoneSeconds } from '$lib/components/zones';
	import { parseSharedSegments } from '$lib/room/workout';
	import { formatWhen } from '$lib/format';
	import { toasts } from '$lib/toast.svelte';
	import { useRoom } from '$lib/room/context';
	import { CalendarClock, Plus } from '@lucide/svelte';

	const room = useRoom();

	let movingId = $state<string | null>(null);
	let moveAt = $state('');

	const minutes = (json: string) =>
		Math.round(
			parseSharedSegments(json).reduce(
				(t, seg) => Math.max(t, seg.startSeconds + seg.seconds),
				0,
			) / 60,
		);

	/** Due enough to offer "start now" — the same window the card always used. */
	const due = (iso: string) => Date.parse(iso) - Date.now() < 15 * 60_000;
</script>

<div class="mx-auto w-full max-w-3xl px-5 py-6">
	<div class="mb-5 flex items-center gap-3">
		<h2 class="font-display text-xl font-bold">What's planned here</h2>
		{#if room.canControl}
			<button
				onclick={() => room.openPicker()}
				class="btn btn-primary btn-xs ml-auto"
				><Plus size={13} /> Plan a session</button
			>
		{/if}
	</div>

	{#if room.upcoming.length === 0}
		<!-- ux.md: empty states teach, never apologise. -->
		<div class="panel px-4 py-8">
			<EmptyState>
				Sessions are how a room agrees on a time. Plan one and it shows up here,
				on everyone's Home, and in their calendar.
				{#snippet cta()}
					{#if room.canControl}
						<button
							onclick={() => room.openPicker()}
							class="btn btn-primary btn-xs">Plan the first session</button
						>
					{/if}
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<ul class="space-y-2">
			{#each room.upcoming as entry, i (entry.id)}
				<li class="panel px-4 py-3 {i === 0 ? 'border-neon/40' : ''}">
					<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
						<CalendarClock size={16} class="text-muted shrink-0" />
						<div class="min-w-0 flex-1">
							<p class="eyebrow">
								{i === 0 ? 'next session in this room' : 'after that'}
							</p>
							<p class="font-display truncate text-base font-bold">
								{entry.workoutName}
							</p>
							<p class="text-muted mt-0.5 text-xs">
								{formatWhen(entry.startsAt, true)} · {minutes(
									entry.workoutJson,
								)} min · planned by {entry.createdBy}
							</p>
						</div>
						<span class="flex shrink-0 items-center gap-3">
							{#if due(entry.startsAt)}
								{#if room.canControl}
									<button
										onclick={() => room.startScheduled(entry)}
										class="btn btn-primary">Start now</button
									>
								{:else}
									<span class="text-watt glow-text text-xs">starting soon</span>
								{/if}
							{/if}
							{#if room.canControl}
								<button
									onclick={() => {
										movingId = movingId === entry.id ? null : entry.id;
										moveAt = '';
									}}
									class="text-muted hover:text-ink text-[11px] underline"
									>move</button
								>
								<button
									onclick={() => room.unschedule(entry.id)}
									class="text-muted hover:text-ink text-[11px] underline"
									>remove</button
								>
							{/if}
						</span>
					</div>
					{#if room.canControl && movingId === entry.id}
						<div class="mt-2 flex flex-wrap items-center gap-2">
							<WhenPicker bind:value={moveAt} />
							<button
								onclick={() => {
									room.reschedule(entry.id, new Date(moveAt).toISOString());
									movingId = null;
								}}
								disabled={room.adminBusy || !moveAt}
								class="btn btn-secondary btn-xs disabled:opacity-40"
								>Move</button
							>
						</div>
					{/if}
					<div class="mt-2">
						<ZoneBar
							seconds={plannedZoneSeconds(
								parseSharedSegments(entry.workoutJson),
								room.you.ftp,
							)}
						/>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if room.icsToken}
		<div class="border-ink/5 mt-4 flex flex-wrap gap-4 border-t pt-3">
			<button
				onclick={() => room.copyIcsUrl()}
				class="text-muted hover:text-ink text-[11px] underline"
				>subscribe to this room</button
			>
			{#if room.myRole === 'owner'}
				<button
					onclick={() => {
						room.rotateIcs();
						toasts.push('Calendar link reset — shared links stop working.');
					}}
					class="text-muted hover:text-ink text-[11px] underline"
					>reset link</button
				>
			{/if}
		</div>
	{/if}

	<h3 class="eyebrow mt-8">this room, this month</h3>
	<div class="panel mt-2 grid grid-cols-2 gap-4 px-4 py-3">
		<div>
			<p class="eyebrow">streak</p>
			<p class="font-display text-xl font-bold tabular-nums">
				{room.streakWeeks} week{room.streakWeeks === 1 ? '' : 's'}
			</p>
		</div>
		<div>
			<p class="eyebrow">work</p>
			<p class="font-display text-xl font-bold tabular-nums">
				{room.monthKj.toLocaleString()} kJ
			</p>
		</div>
	</div>
</div>
