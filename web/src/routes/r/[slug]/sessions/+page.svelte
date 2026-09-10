<script lang="ts">
	// The room's Sessions place (ADR-0020). Was a card wedged under the rider
	// tiles, visible only in the lounge; it has a URL now, and /sessions —
	// the cross-room list — folded into Home (#388).
	import WhenPicker from '$lib/components/WhenPicker.svelte';
	import WorkoutPreview from '$lib/components/WorkoutPreview.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { parseSharedSegments } from '$lib/room/workout';
	import { segmentsDuration } from '$lib/workout/engine';
	import { confirm } from '$lib/confirm.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { device } from '$lib/device.svelte';
	import { formatWhen } from '$lib/format';
	import { toasts } from '$lib/toast.svelte';
	import { useRoom } from '$lib/room/context';
	import SessionRecapCard from '$lib/room/SessionRecapCard.svelte';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import Copy from '@lucide/svelte/icons/copy';
	import Link from '@lucide/svelte/icons/link';
	import Play from '@lucide/svelte/icons/play';
	import Plus from '@lucide/svelte/icons/plus';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import { serverNow } from '$lib/room/server-clock';

	const room = useRoom();
	// The roles matrix gives a spectator none of this (docs/SPEC.md) — the
	// same gate SessionControls wears, or a phone plans and starts sessions
	// it cannot ride.
	const manages = $derived(room.canControl && !device.spectator);
	// What already happened here (ADR-0034 amended, #1331): the recaps the
	// backlog seeds and the tick adds, newest first — the same cards the chat
	// shows in its scrollback, on the place that plans the next one.
	const past = $derived([...room.recaps].sort((a, b) => b.endedAt - a.endedAt));

	let movingId = $state<string | null>(null);
	let moveAt = $state('');

	const minutes = (json: string) =>
		Math.round(segmentsDuration(parseSharedSegments(json)) / 60);

	/** Due enough to offer "start now" — the same window the card always used,
	 * on the server's clock like the timeline's reminder (#1909): a laptop
	 * twenty minutes fast offered it thirty-five minutes early. */
	const due = (iso: string) => Date.parse(iso) - serverNow() < 15 * 60_000;

	/** A plan with an RSVP is what #450 calls an event; no second object. */
	const going = (entry: { going?: { id: string; displayName: string }[] }) =>
		entry.going ?? [];
	const youAreIn = (entry: { going?: { id: string; displayName: string }[] }) =>
		going(entry).some((who) => who.id === room.you.id);

	/** The place's address, for a chat or a calendar note. */
	function copyLink() {
		const link = `${location.origin}/r/${room.slug}/sessions`;
		void navigator.clipboard.writeText(link).then(
			() => toasts.push('Link copied.'),
			() =>
				toasts.push(`Could not copy — the link is ${link}`, {
					tone: 'error',
					seconds: 12,
				}),
		);
	}

	// The row's right-click (ux.md, #1373): the buttons keep the primary
	// actions, this holds every one of them plus the link the row has no
	// room for. A coach's entries name why they are greyed.
	function planEntries(entry: (typeof room.upcoming)[number]): MenuEntry[] {
		const inn = youAreIn(entry);
		const entries: MenuEntry[] = [
			{
				label: inn ? "I'm out" : "I'm in",
				icon: inn ? UserMinus : UserCheck,
				onSelect: () => room.rsvp(entry.id, !inn),
				disabled: room.adminBusy,
			},
			{ label: 'Copy link', icon: Link, onSelect: copyLink },
		];
		if (!manages) return entries;
		const startable = due(entry.startsAt) && room.phase === 'lounge';
		entries.push(
			'separator',
			{
				label: 'Start now',
				icon: Play,
				onSelect: () => room.startScheduled(entry),
				disabled: !startable || room.adminBusy,
				hint: startable
					? undefined
					: room.phase !== 'lounge'
						? 'a session is running'
						: 'not due yet',
			},
			{
				label: 'Move…',
				icon: CalendarClock,
				onSelect: () => {
					movingId = entry.id;
					moveAt = '';
				},
			},
			'separator',
			{
				label: 'Cancel the session',
				icon: CircleX,
				onSelect: () => void cancelPlan(entry),
				danger: true,
				disabled: room.adminBusy,
			},
		);
		return entries;
	}

	/** No inverse exists — the RSVPs go with it — so it asks first (errors.md). */
	async function cancelPlan(entry: {
		id: string;
		workoutName: string;
		going?: { id: string; displayName: string }[];
	}) {
		const n = going(entry).length;
		const ok = await confirm({
			title: `Cancel “${entry.workoutName}”?`,
			body: n
				? `${n} rider${n === 1 ? ' has' : 's have'} said they're in — they get an email. It cannot be put back.`
				: 'The room gets an email. It cannot be put back.',
			action: 'Cancel the session',
			cancel: 'Keep it',
		});
		if (ok) room.unschedule(entry.id);
	}
</script>

{#snippet plan()}
	<button onclick={() => room.openPicker('plan')} class="btn btn-primary btn-xs"
		>Plan the first session</button
	>
{/snippet}

<div class="page">
	<div class="mb-5 flex items-center gap-3">
		<h2 class="font-display text-xl font-bold">What's planned here</h2>
		<!-- One button to plan with: the empty state's while the list is
		     empty, this one once it is not. -->
		{#if manages && room.upcoming.length > 0}
			<button
				onclick={() => room.openPicker('plan')}
				class="btn btn-primary btn-xs ml-auto"
				><Plus size={13} /> Plan a session</button
			>
		{/if}
	</div>

	{#if room.upcoming.length === 0}
		<!-- ux.md: empty states teach, never apologise — and never tell a
		     member to do the coach's job. -->
		<div class="panel px-4 py-8">
			<EmptyState cta={manages ? plan : undefined}>
				{#if manages}
					Sessions are how a room agrees on a time. Plan one and it shows up
					here, on everyone's Home, and in their calendar.
				{:else}
					Sessions are how a room agrees on a time. Your coach plans them here;
					you say whether you're in, and each lands on your Home and in your
					calendar.
				{/if}
			</EmptyState>
		</div>
	{:else}
		<ul class="space-y-2">
			{#each room.upcoming as entry, i (entry.id)}
				<li
					class="panel px-4 py-3 {i === 0 ? 'border-neon/40' : ''}"
					title={MENU_HINT}
					{@attach contextMenu(() => planEntries(entry))}
				>
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
							<!-- Only while nothing runs: the hub refuses a pick outside
							     idle, and the tap used to wipe the rider's own recording
							     before it was refused. A running ride is joined from the
							     Lounge or Training. -->
							{#if due(entry.startsAt) && room.phase === 'lounge'}
								{#if manages}
									<button
										onclick={() => room.startScheduled(entry)}
										disabled={room.adminBusy}
										class="btn btn-primary">Start now</button
									>
								{:else}
									<span class="text-watt glow-text text-xs">starting soon</span>
								{/if}
							{/if}
							{#if manages}
								<button
									onclick={() => {
										movingId = movingId === entry.id ? null : entry.id;
										moveAt = '';
									}}
									disabled={room.adminBusy}
									class="btn btn-secondary btn-xs">Move</button
								>
								<!-- "Cancel", as the chat line, the mail and SPEC say. -->
								<button
									onclick={() => void cancelPlan(entry)}
									disabled={room.adminBusy}
									class="btn btn-danger btn-xs">Cancel</button
								>
							{/if}
						</span>
					</div>
					<!-- Being there is not a role (#450): every member says yes for
					     themselves, and there is no maybe. -->
					<div class="mt-2 flex flex-wrap items-center gap-3">
						<button
							onclick={() => room.rsvp(entry.id, !youAreIn(entry))}
							disabled={room.adminBusy}
							class="btn btn-xs disabled:opacity-40 {youAreIn(entry)
								? 'btn-secondary'
								: 'btn-primary'}"
							>{youAreIn(entry) ? "You're in" : "I'm in"}</button
						>
						<span class="text-muted text-xs">
							{#if going(entry).length}
								{going(entry)
									.slice(0, 4)
									.map((who) => who.displayName)
									.join(', ')}{going(entry).length > 4
									? ` +${going(entry).length - 4} more`
									: ''}
							{:else}
								nobody has said yes yet
							{/if}
						</span>
					</div>
					{#if manages && movingId === entry.id}
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
					<!-- The workout as the shelf draws it (#1525): a stacked bar
					     said how long each zone lasts and never what the session
					     looks like — where the efforts are, and how long. -->
					<div class="mt-3">
						<WorkoutPreview
							segments={parseSharedSegments(entry.workoutJson)}
							ftp={room.you.ftp}
							compact={i > 0}
							legendClass="mb-1.5"
						/>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if room.icsToken}
		<!-- The room's calendar (ADR-0021): a club schedule, shareable with
		     people who are not in the room. Your own link — every room at
		     once — is on Home, under What's next; this row says so rather
		     than offering a second subscription per room (#1374). -->
		<div class="panel mt-4 flex flex-wrap items-center gap-3 px-4 py-3">
			<CalendarClock size={16} class="text-muted shrink-0" />
			<p class="text-muted min-w-0 flex-1 text-xs">
				This room's schedule as a calendar link, for people who are not in it.
				Your own calendar — every room you are in, one link — is on <a
					href="/home#sessions"
					class="underline">Home</a
				>.
			</p>
			<button
				onclick={() => room.copyIcsUrl()}
				class="btn btn-secondary btn-xs shrink-0"
				><Copy size={13} /> Copy calendar link</button
			>
		</div>
		{#if room.myRole === 'owner'}
			<!-- The feed URL carries a private token (ADR-0021). Rotating it is
			     for a leaked link, which 95% of owners never need (ux.md) — so
			     it lives folded, with the one line that says what it does. -->
			<details class="mt-2">
				<summary class="text-muted hover:text-ink cursor-pointer text-[11px]"
					>Advanced</summary
				>
				<p class="text-muted mt-2 max-w-md text-xs">
					The calendar link carries a private key for this room. If it ever
					leaks, reset it: every calendar that has the old link stops updating
					until it subscribes again.
				</p>
				<button
					onclick={() =>
						void Promise.resolve(room.rotateIcs()).then((ok) => {
							if (ok !== false)
								toasts.push('Calendar link reset — shared links stop working.');
						})}
					class="btn btn-secondary btn-xs mt-2">Reset calendar link</button
				>
			</details>
		{/if}
	{/if}

	<!-- All four states (errors.md, #1538): the backlog is the only source of
	     these, and a failed fetch used to erase the room's past in silence. -->
	<h3 class="eyebrow mt-8">past sessions</h3>
	{#if past.length > 0}
		<ul class="mt-2 grid gap-2">
			{#each past.slice(0, 12) as recap (recap.id)}
				<li><SessionRecapCard {recap} /></li>
			{/each}
		</ul>
	{:else if room.recapsState === 'loading'}
		<Skeleton rows={2} class="mt-2 h-16" />
	{:else if room.recapsState === 'failed'}
		<div class="mt-2">
			<Banner tone="error">
				The room's finished sessions could not be loaded.
				{#snippet action()}
					<button
						class="btn btn-secondary btn-xs"
						onclick={() => room.retryRecaps()}>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else}
		<div class="mt-2">
			<EmptyState>
				Finished sessions land here — who rode, and for how long.
			</EmptyState>
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
