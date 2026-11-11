<script lang="ts">
	// The crew's Schedule (#2452, ADR-0058): the room's Sessions place, ported
	// onto the crew — one calendar. Any member plans and answers; the owner
	// and admins move and cancel any plan, a member their own; starting one
	// opens a session of the crew's own with you as coach (docs/SESSIONS.md,
	// #2440). Owns the four states
	// (errors.md).
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { account } from '#lib/account.svelte.ts';
	import {
		confirmCalendarReset,
		copyCalendarLink,
		RESET_DONE,
	} from '#lib/calendar-link.ts';
	import Banner from '#lib/components/Banner.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import NotifyOffer from '#lib/components/NotifyOffer.svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import WhenPicker from '#lib/components/WhenPicker.svelte';
	import WorkoutPreview from '#lib/components/WorkoutPreview.svelte';
	import { toLocalInput } from '#lib/components/when.ts';
	import { confirm } from '#lib/confirm.svelte.ts';
	import { contextMenu, MENU_HINT } from '#lib/context-menu.svelte.ts';
	import { fetchCrew, type Crew } from '#lib/crew.ts';
	import {
		cancelCrewPlan,
		crewCalendarLink,
		fetchCrewSchedule,
		mayRearrange,
		moveCrewPlan,
		planCrewSession,
		planDue,
		planPlace,
		pressAnswer,
		rotateCrewCalendar,
		startedPath,
		startCrewPlan,
		type CrewPlan,
	} from '#lib/crew-schedule.ts';
	import { device } from '#lib/device.svelte.ts';
	import { channelConnection } from '#lib/channel/connection.svelte.ts';
	import { needsTrainer } from '#lib/session/sensor-status.ts';
	import { formatWhen } from '#lib/format.ts';
	import { presence } from '#lib/presence.svelte.ts';
	import RsvpRow from '#lib/session/RsvpRow.svelte';
	import SessionPicker from '#lib/session/SessionPicker.svelte';
	import { takePickerDoor } from '#lib/session/doors.ts';
	import type { RsvpAnswer } from '#lib/session/rsvp.ts';
	import { parseSharedSegments } from '#lib/workout/shared.ts';
	import { serverNow } from '#lib/server-clock.ts';
	import { shareLink } from '#lib/share.ts';
	import { toasts } from '#lib/toast.svelte.ts';
	import { segmentsDuration } from '#lib/workout/engine.ts';
	import { customWorkouts } from '#lib/workout/custom.svelte.ts';
	import { buildShelf } from '#lib/workout/shelf.ts';
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
	let error = $state<string | null>(untrack(() => data.error));
	let errorCode = $state<string | null>(untrack(() => data.errorCode));
	// The plan a link named (#2608): every surface that shows one links to
	// its row here. Scrolled by hand, as Home's #sessions is: SvelteKit's hash
	// scroll moves the window, and the shell scrolls its page column (#1199).
	const marked = $derived(
		page.url.hash.startsWith('#plan-') ? page.url.hash.slice(6) : '',
	);
	const markedListed = $derived(
		!!marked && !!plans?.some((plan) => plan.id === marked),
	);
	$effect(() => {
		if (!markedListed) return;
		queueMicrotask(() =>
			document
				.getElementById(`plan-${marked}`)
				?.scrollIntoView({ block: 'center' }),
		);
	});
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

	// The picker, plan-only: a calendar starts nothing (#1767). "Plan a
	// session" on the crew's Home and on yours lands here with it open
	// (#2572), so the plan is made where it will be listed.
	// The editor, opened from this picker, comes back with it open on what
	// the rider built (#4082).
	const door = untrack(() => takePickerDoor(page.url));
	let picking = $state(
		untrack(() => page.url.searchParams.has('plan')) || !!door,
	);
	const custom = customWorkouts();
	const shelf = $derived(buildShelf(custom.all));

	async function plan(name: string, json: string, startsAtIso: string) {
		busy = true;
		const res = await planCrewSession(id, {
			workoutName: name,
			workoutJson: json,
			startsAt: startsAtIso,
		});
		busy = false;
		// Closed only once the server took it (#1766): a refused time keeps
		// the workout and the time chosen, and the picker says why under the
		// field (#2613).
		if (!res.ok) return res.error.message;
		picking = false;
		await reload();
	}

	const minutes = (json: string) =>
		Math.round(segmentsDuration(parseSharedSegments(json)) / 60);

	const going = (entry: CrewPlan) => entry.going ?? [];
	const answer = (entry: CrewPlan) => entry.yourAnswer ?? null;
	async function choose(entry: CrewPlan, pressed: RsvpAnswer) {
		const res = await pressAnswer(id, entry, pressed);
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		await reload();
	}

	let movingId = $state<string | null>(null);
	let moveAt = $state('');
	// Beside the field while it still holds the refused time (#2613).
	let moveRefused = $state<{ id: string; at: string; message: string } | null>(
		null,
	);
	async function move(entry: CrewPlan) {
		busy = true;
		const res = await moveCrewPlan(
			id,
			entry.id,
			new Date(moveAt).toISOString(),
		);
		busy = false;
		if (!res.ok) {
			moveRefused = { id: entry.id, at: moveAt, message: res.error.message };
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
			// Every member who gets session mail is told, not only the riders
			// who are in (#2634).
			body: `${who}.${mailed ? ' Everyone who gets session emails for it is told.' : ''} It cannot be put back.`,
			action: 'Cancel the session',
		});
		if (!ok) return;
		const res = await cancelCrewPlan(id, entry.id);
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		await reload();
	}

	/** Opens the session in the plan's channel — or the one picked above,
	 *  for a plan that named none — and takes you there (#2440). A channel
	 *  another coach holds answers with their name. */
	// The gear first (#2594, #2880), read the way the plan's card in the voice
	// channel reads it: the trainer this screen's connection holds, or one
	// another screen of yours holds. Starting unpaired stays a choice — a
	// coach may lead without riding — but a named one, not an accident.
	const unpaired = $derived(
		needsTrainer(
			channelConnection.current?.ride.trainer,
			channelConnection.current?.live.pairing,
		),
	);

	async function start(entry: CrewPlan) {
		busy = true;
		const res = await startCrewPlan(id, entry.id);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		void goto(startedPath(id, res.data));
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
			startHint: startHint({
				due: planDue(entry.startsAt),
				spectator: device.spectator,
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
</script>

<svelte:head>
	<title>Schedule · {crew?.name ?? 'Crew'} · WattRoom</title>
</svelte:head>

{#snippet firstPlan()}
	{@render planButton('Plan the first session')}
{/snippet}

{#snippet planButton(label: string)}
	<button onclick={() => (picking = true)} class="btn btn-primary btn-xs"
		><Plus size={13} /> {label}</button
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
			<a href="/crew/{crew.id}/workouts" class="btn-link text-xs"
				>Ridden together</a
			>
			{#if plans.length > 0}
				<span class="ml-auto">{@render planButton('Plan a session')}</span>
			{/if}
		</div>
		<p class="text-muted mb-4 text-xs">What {crew.name} has planned.</p>

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
						id="plan-{entry.id}"
						aria-current={entry.id === marked ? 'true' : undefined}
						class="panel px-4 py-3 {i === 0
							? 'border-neon/40'
							: ''} {entry.id === marked ? 'ring-neon ring-2' : ''}"
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
								{#if planDue(entry.startsAt)}
									{#if device.spectator}
										<span class="text-ink text-xs font-medium"
											>starting soon</span
										>
									{:else}
										<!-- A plan opens a session of the crew's own, in no voice
										     channel (docs/SESSIONS.md): one Start for every plan. -->
										{#if unpaired}<a
												href="/settings/equipment"
												class="text-muted text-xs underline"
												>Pair your trainer first</a
											>{/if}
										<button
											onclick={() => void start(entry)}
											disabled={busy}
											class="btn {unpaired ? 'btn-secondary' : 'btn-primary'}"
											>{unpaired
												? 'Start without a trainer'
												: 'Start now'}</button
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
						<div class="mt-2">
							<RsvpRow
								plan={entry}
								onChoose={(word) => void choose(entry, word)}
							/>
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
							{#if moveRefused?.id === entry.id && moveRefused.at === moveAt}
								<p class="text-danger mt-2 text-xs" role="alert">
									{moveRefused.message}
								</p>
							{/if}
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
			<!-- Beside the plans that make it worth having (ADR-0042, #2612):
			     NotifyOffer decides whether it can succeed here. -->
			<NotifyOffer />
		{/if}

		{#if crew.icsToken}
			<!-- The crew's calendar (ADR-0021, #2441): shareable with people who
			     are not in it, and it leaves out a private channel's plans. -->
			<div class="panel mt-4 flex flex-wrap items-center gap-3">
				<CalendarClock size={16} class="text-muted shrink-0" />
				<p class="text-muted min-w-0 flex-1 text-xs">
					This crew's schedule as a calendar link, for anyone — plans in private
					channels stay out of it. Your own calendar, every crew at once, is in <a
						href="/settings/data"
						class="underline">Settings → Data</a
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
					<!-- py-1.5: a fold is a control, and 24 px is the floor (#2886). -->
					<summary
						class="text-muted hover:text-ink cursor-pointer py-1.5 text-[11px]"
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
		pick={door?.pick}
		shelfError={custom.error}
		onRetryShelf={() => void custom.retry()}
		intent="plan"
		ftp={account.me?.ftpWatts ?? 200}
		{busy}
		onPlan={plan}
		onClose={() => (picking = false)}
	></SessionPicker>
{/if}
