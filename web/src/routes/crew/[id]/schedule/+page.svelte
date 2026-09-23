<script lang="ts">
	// The crew's Schedule (#2452, ADR-0058): the room's Sessions place, ported
	// onto the crew — one calendar, and a plan names the voice channel it will
	// run in, or none yet. Any member plans and answers; the owner and admins
	// move and cancel any plan, a member their own; starting one opens its
	// session in its channel with you as coach (#2440). Owns the four states
	// (errors.md).
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { account } from '$lib/account.svelte';
	import {
		confirmCalendarReset,
		copyCalendarLink,
		RESET_DONE,
	} from '$lib/calendar-link';
	import {
		fetchCrewChannels,
		voiceChannelPath,
		type CrewChannel,
	} from '$lib/channels';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Select from '$lib/components/Select.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import WhenPicker from '$lib/components/WhenPicker.svelte';
	import WorkoutPreview from '$lib/components/WorkoutPreview.svelte';
	import { toLocalInput } from '$lib/components/when';
	import { confirm } from '$lib/confirm.svelte';
	import { contextMenu, MENU_HINT } from '$lib/context-menu.svelte';
	import { fetchCrew, type Crew } from '$lib/crew';
	import {
		answerCrewPlan,
		cancelCrewPlan,
		crewCalendarLink,
		fetchCrewSchedule,
		mayRearrange,
		moveCrewPlan,
		planCrewSession,
		planPlace,
		rotateCrewCalendar,
		startCrewPlan,
		type CrewPlan,
	} from '$lib/crew-schedule';
	import { device } from '$lib/device.svelte';
	import { formatWhen } from '$lib/format';
	import { chosenCrew } from '$lib/nav/chosen-crew.svelte';
	import { presence } from '$lib/presence.svelte';
	import SessionPicker from '$lib/room/SessionPicker.svelte';
	import {
		rsvpSummary,
		tallyOf,
		whoIsInOf,
		type RsvpAnswer,
	} from '$lib/room/rsvp';
	import { parseSharedSegments } from '$lib/workout/shared';
	import { serverNow } from '$lib/server-clock';
	import { shareLink } from '$lib/share';
	import { toasts } from '$lib/toast.svelte';
	import { segmentsDuration } from '$lib/workout/engine';
	import { customWorkouts } from '$lib/workout/custom.svelte';
	import { buildShelf } from '$lib/workout/shelf';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Copy from '@lucide/svelte/icons/copy';
	import Plus from '@lucide/svelte/icons/plus';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';
	import { planEntries, startHint } from './plan-menu';

	let { data }: { data: PageData } = $props();

	const id = $derived(page.params.id ?? '');
	let crew = $state<Crew | null>(untrack(() => data.crew));
	let plans = $state<CrewPlan[] | null>(untrack(() => data.plans));
	let voice = $state<CrewChannel[]>(untrack(() => data.voice));
	let error = $state<string | null>(untrack(() => data.error));
	let errorCode = $state<string | null>(untrack(() => data.errorCode));
	let busy = $state(false);

	async function reload() {
		const [c, s] = await Promise.all([fetchCrew(id), fetchCrewSchedule(id)]);
		const failed = !c.ok ? c : !s.ok ? s : null;
		if (failed && !failed.ok) {
			// Only a first load fails loudly: this also runs on every lobby
			// ping, and a hiccup must not replace the page with a sentence.
			if (!crew) {
				error = failed.error.message;
				errorCode = failed.error.error;
			}
			return;
		}
		error = null;
		if (c.ok) crew = c.data;
		if (s.ok) plans = s.data.sessions;
	}
	// Somebody else planned, moved or answered (#570): the lobby says so.
	let seenVersion = untrack(() => presence.version);
	$effect(() => {
		const version = presence.version;
		if (version === seenVersion) return;
		seenVersion = version;
		if (untrack(() => crew)) void reload();
	});
	$effect(() => {
		if (crew) chosenCrew.set(crew.id);
	});

	// Where a new plan goes: the crew's first voice channel, or none.
	let planChannel = $state(untrack(() => data.voice[0]?.id ?? ''));
	const channelOptions = $derived([
		...voice.map((c) => ({ value: c.id, label: c.name })),
		{ value: '', label: 'No channel yet' },
	]);

	// The picker, plan-only: a calendar starts nothing (#1767).
	let picking = $state(false);
	const custom = customWorkouts();
	const shelf = $derived(buildShelf(custom.all));

	async function plan(name: string, json: string, startsAtIso: string) {
		busy = true;
		const res = await planCrewSession(id, {
			workoutName: name,
			workoutJson: json,
			startsAt: startsAtIso,
			channelId: planChannel || undefined,
		});
		busy = false;
		// Closed only once the server took it (#1766): a refused time keeps
		// the workout and the time chosen.
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		picking = false;
		await reload();
	}

	const minutes = (json: string) =>
		Math.round(segmentsDuration(parseSharedSegments(json)) / 60);
	/** Due enough to offer "start now", on the server's clock (#1909). */
	const due = (iso: string) => Date.parse(iso) - serverNow() < 15 * 60_000;

	const going = (entry: CrewPlan) => entry.going ?? [];
	const answer = (entry: CrewPlan) => entry.yourAnswer ?? null;
	/** Your own answer again takes it back; the other one changes your mind.
	 *  Neither asks: a second tap undoes it (errors.md). */
	async function choose(entry: CrewPlan, pressed: RsvpAnswer) {
		const res = await answerCrewPlan(
			id,
			entry.id,
			answer(entry) === pressed ? null : pressed,
		);
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		await reload();
	}

	let movingId = $state<string | null>(null);
	let moveAt = $state('');
	async function move(entry: CrewPlan) {
		busy = true;
		const res = await moveCrewPlan(
			id,
			entry.id,
			new Date(moveAt).toISOString(),
		);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		movingId = null;
		await reload();
	}

	/** No inverse exists — the answers go with it — so it asks first. */
	async function cancel(entry: CrewPlan) {
		const n = going(entry).length;
		const mailed =
			!!account.me?.mailAvailable && Date.parse(entry.startsAt) > serverNow();
		const who = n
			? `${n} rider${n === 1 ? ' has' : 's have'} said they're in — they lose the plan`
			: 'The crew loses the plan';
		const ok = await confirm({
			title: `Cancel “${entry.workoutName}”?`,
			body: `${who}${mailed ? ', and get an email' : ''}. It cannot be put back.`,
			action: 'Cancel the session',
			cancel: 'Keep it',
		});
		if (!ok) return;
		const res = await cancelCrewPlan(id, entry.id);
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		await reload();
	}

	/** Opens the session in the plan's channel — or the one picked above,
	 *  for a plan that named none — and takes you there (#2440). A channel
	 *  another coach holds answers with their name. */
	async function start(entry: CrewPlan) {
		busy = true;
		const res = await startCrewPlan(
			id,
			entry.id,
			entry.channelId ? undefined : planChannel || undefined,
		);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		void goto(voiceChannelPath(id, res.data.channelId));
	}

	/** The row's menu (#2514): every button it has, plus the link. */
	const entriesOf = (entry: CrewPlan) =>
		planEntries({
			answer: answer(entry),
			choose: (word) => void choose(entry, word),
			share: () =>
				void shareLink(
					`${location.origin}/crew/${id}/schedule`,
					'Link copied.',
				),
			rearranges: !!crew && mayRearrange(entry, crew.role),
			move: () => {
				movingId = entry.id;
				moveAt = toLocalInput(new Date(entry.startsAt));
			},
			cancel: () => void cancel(entry),
			startHint: startHint(entry, {
				due: due(entry.startsAt),
				spectator: device.spectator,
				channelPicked: !!planChannel,
			}),
			start: () => void start(entry),
			busy,
		});

	const administers = $derived(
		crew?.role === 'owner' || crew?.role === 'admin',
	);
	/** The crew's calendar, rotated — the ask first: nothing puts the old
	 *  link back and it is the subscribers' calendars that go quiet. */
	async function resetCalendar() {
		if (!(await confirmCalendarReset('crew'))) return;
		const res = await rotateCrewCalendar(id);
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		if (crew) crew = { ...crew, icsToken: res.data.icsToken };
		toasts.push(RESET_DONE);
	}

	async function retry() {
		error = null;
		await reload();
	}
	// The pick's list, read again as the picker opens: a channel made a
	// minute ago in Settings should be there to pick.
	async function reloadVoice() {
		const res = await fetchCrewChannels(id);
		if (res.ok) voice = res.data.channels.filter((c) => c.kind === 'voice');
	}
</script>

<svelte:head>
	<title>Schedule · {crew?.name ?? 'Crew'} · WattRoom</title>
</svelte:head>

{#snippet firstPlan()}
	{@render planButton('Plan the first session')}
{/snippet}

{#snippet planButton(label: string)}
	<button
		onclick={() => {
			picking = true;
			void reloadVoice();
		}}
		class="btn btn-primary btn-xs"><Plus size={13} /> {label}</button
	>
{/snippet}

<main class="page">
	{#if error && !crew}
		<div class="mt-4">
			<Banner tone="error">
				{error}
				{#snippet action()}
					{#if errorCode !== 'not_found'}
						<button onclick={() => void retry()} class="btn-link text-xs"
							>Retry</button
						>
					{/if}
				{/snippet}
			</Banner>
		</div>
	{:else if !crew || !plans}
		<Skeleton rows={3} class="mt-4 h-20" />
	{:else}
		<div class="mb-1 flex flex-wrap items-center gap-3">
			<h1 class="page-title">Schedule</h1>
			{#if plans.length > 0}
				<span class="ml-auto">{@render planButton('Plan a session')}</span>
			{/if}
		</div>
		<p class="text-muted mb-4 text-xs">What {crew.name} has planned.</p>

		{#if voice.length > 0}
			<!-- Where a new plan goes, said before the picker opens: most
			     crews have one voice channel, and then this is only a line. -->
			<div class="mb-4 flex flex-wrap items-center gap-2 text-xs">
				<span class="text-muted">New plans run in</span>
				<div class="w-48">
					<Select
						label="voice channel"
						options={channelOptions}
						bind:value={planChannel}
					/>
				</div>
			</div>
		{/if}

		{#if plans.length === 0}
			<div class="panel">
				<EmptyState cta={firstPlan}>
					Sessions are how a crew agrees on a time. Plan one and it shows up
					here, on everyone's Home, and in their calendar.
				</EmptyState>
			</div>
		{:else}
			<ul class="space-y-2">
				{#each plans as entry, i (entry.id)}
					<li
						class="panel px-4 py-3 {i === 0 ? 'border-neon/40' : ''}"
						title={MENU_HINT}
						{@attach contextMenu(() => entriesOf(entry))}
					>
						<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
							<CalendarClock size={16} class="text-muted shrink-0" />
							<div class="min-w-0 flex-1">
								<p class="eyebrow">
									{i === 0 ? 'next session in this crew' : 'after that'}
								</p>
								<p class="font-display truncate text-base font-bold">
									{entry.workoutName}
								</p>
								<p class="text-muted mt-0.5 text-xs">
									{formatWhen(entry.startsAt, true)} · {minutes(
										entry.workoutJson,
									)} min · {planPlace(entry)} · planned by {entry.createdBy}
								</p>
							</div>
							<span
								class="flex shrink-0 basis-full flex-wrap items-center gap-3 sm:basis-auto"
							>
								<!-- The cockpit stays on the screen a coach rides on (#1767):
								     a phone plans, and does not start. -->
								{#if due(entry.startsAt)}
									{#if device.spectator}
										<span class="text-watt glow-text text-xs"
											>starting soon</span
										>
									{:else}
										<button
											onclick={() => void start(entry)}
											disabled={busy || (!entry.channelId && !planChannel)}
											title={!entry.channelId && !planChannel
												? 'Pick a voice channel above to start it in'
												: undefined}
											class="btn btn-primary">Start now</button
										>
									{/if}
								{/if}
								{#if mayRearrange(entry, crew.role)}
									<button
										onclick={() => {
											movingId = movingId === entry.id ? null : entry.id;
											moveAt = toLocalInput(new Date(entry.startsAt));
										}}
										disabled={busy}
										class="btn btn-secondary btn-xs">Move…</button
									>
									<button
										onclick={() => void cancel(entry)}
										disabled={busy}
										class="btn btn-danger btn-xs">Cancel session</button
									>
								{/if}
							</span>
						</div>
						<!-- Being there is not a role (#450): two words, no maybe, and
						     aria-pressed says which is yours. -->
						<div class="mt-2 flex flex-wrap items-center gap-3">
							{#each ['in', 'out'] as const as word (word)}
								<button
									onclick={() => void choose(entry, word)}
									aria-pressed={answer(entry) === word}
									class="btn btn-xs {answer(entry) === word
										? 'btn-primary'
										: 'btn-secondary'}"
									>{word === 'in' ? "I'm in" : "I'm out"}</button
								>
							{/each}
							<span class="text-muted text-xs"
								>{rsvpSummary(tallyOf(entry), whoIsInOf(entry))}</span
							>
						</div>
						{#if movingId === entry.id}
							<div class="mt-2 flex flex-wrap items-center gap-2">
								<WhenPicker bind:value={moveAt} />
								<button
									onclick={() => void move(entry)}
									disabled={busy || !moveAt}
									class="btn btn-secondary btn-xs disabled:opacity-40"
									>Move to this time</button
								>
							</div>
						{/if}
						<div class="mt-3">
							<WorkoutPreview
								segments={parseSharedSegments(entry.workoutJson)}
								ftp={account.me?.ftpWatts ?? 200}
								compact={i > 0}
								legendClass="mb-1.5"
							/>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if crew.icsToken}
			<!-- The crew's calendar (ADR-0021, #2441): shareable with people who
			     are not in it, and it leaves out a private channel's plans. -->
			<div class="panel mt-4 flex flex-wrap items-center gap-3">
				<CalendarClock size={16} class="text-muted shrink-0" />
				<p class="text-muted min-w-0 flex-1 text-xs">
					This crew's schedule as a calendar link, for anyone — plans in private
					channels stay out of it. Your own calendar, every crew at once, is on <a
						href="/home#sessions"
						class="underline">Home</a
					>.
				</p>
				<button
					onclick={() =>
						void copyCalendarLink(
							crewCalendarLink(
								location.origin,
								crew?.id ?? id,
								crew?.icsToken ?? '',
							),
						)}
					class="btn btn-secondary btn-xs shrink-0 basis-full sm:basis-auto"
					><Copy size={13} /> Copy calendar link</button
				>
			</div>
			{#if administers}
				<!-- For a leaked link, which 95% of crews never need (ux.md):
				     folded, with the one line that says what it breaks. -->
				<details class="mt-2">
					<summary class="text-muted hover:text-ink cursor-pointer text-[11px]"
						>Advanced</summary
					>
					<p class="text-muted mt-2 max-w-md text-xs">
						The calendar link carries a private key for this crew. If it ever
						leaks, reset it: every calendar that has the old link stops updating
						until it subscribes again.
					</p>
					<button
						onclick={() => void resetCalendar()}
						class="btn btn-secondary btn-xs mt-2">Reset calendar link</button
					>
				</details>
			{/if}
		{/if}
	{/if}
</main>

{#if picking}
	<SessionPicker
		{shelf}
		shelfError={custom.error}
		onRetryShelf={() => void custom.retry()}
		intent="plan"
		ftp={account.me?.ftpWatts ?? 200}
		{busy}
		onPlan={plan}
		onClose={() => (picking = false)}
	/>
{/if}
