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
	import { fetchCrewChannels, type CrewChannel } from '$lib/channels';
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
	} from '$lib/crew-schedule';
	import { device } from '$lib/device.svelte';
	import { formatWhen } from '$lib/format';
	import { presence } from '$lib/presence.svelte';
	import { crewLive } from '$lib/nav/crew-live.svelte';
	import RsvpRow from '$lib/session/RsvpRow.svelte';
	import SessionPicker from '$lib/session/SessionPicker.svelte';
	import type { RsvpAnswer } from '$lib/session/rsvp';
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

	// Where a new plan goes: the crew's first voice channel, or none.
	let planChannel = $state(untrack(() => data.voice[0]?.id ?? ''));
	// Where a plan that names no channel starts (#2607): chosen on its own
	// row. It used to borrow the picker's choice, so picking "No channel yet"
	// for one plan greyed every other's Start now, and the hint pointed
	// "above" at a control that had moved into the picker. Falls back to the
	// first channel if the chosen one goes.
	let startChoice = $state(untrack(() => data.voice[0]?.id ?? ''));
	const startIn = $derived(voice.find((c) => c.id === startChoice) ?? voice[0]);
	const voiceOptions = $derived(
		voice.map((c) => ({ value: c.id, label: c.name })),
	);
	const channelOptions = $derived([
		...voice.map((c) => ({ value: c.id, label: c.name })),
		{ value: '', label: 'No channel yet' },
	]);

	// The picker, plan-only: a calendar starts nothing (#1767). "Plan a
	// session" on the crew's Home and on yours lands here with it open
	// (#2572), so the plan is made where it will be listed.
	let picking = $state(untrack(() => page.url.searchParams.has('plan')));
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
	/** Who is coaching a session in the plan's channel right now (#2606):
	 *  its Start now would be refused with their name, so it stands down
	 *  and says so instead (errors.md: never a button that will fail). */
	const coachingIn = (entry: CrewPlan) =>
		entry.channelId
			? crewLive.crew(id)?.channels.find((c) => c.id === entry.channelId)
					?.session?.coachName
			: undefined;

	const going = (entry: CrewPlan) => entry.going ?? [];
	const answer = (entry: CrewPlan) => entry.yourAnswer ?? null;
	async function choose(entry: CrewPlan, pressed: RsvpAnswer) {
		const res = await pressAnswer(id, entry, pressed);
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
			entry.channelId ? undefined : startIn?.id,
		);
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
			startHint: startHint(entry, {
				due: planDue(entry.startsAt),
				spectator: device.spectator,
				voiceChannels: voice.length > 0,
				coaching: coachingIn(entry),
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
										<span class="text-watt glow-text text-xs"
											>starting soon</span
										>
									{:else if coachingIn(entry)}
										<span class="text-muted text-xs"
											>{coachingIn(entry)} is coaching in {entry.channelName}</span
										>
									{:else if entry.channelId}
										<button
											onclick={() => void start(entry)}
											disabled={busy}
											class="btn btn-primary">Start now</button
										>
									{:else if startIn}
										<!-- No channel named: where it runs is chosen here, with
										     the start, and the button says where (#2607). -->
										<span class="w-44">
											<Select
												label="voice channel to start it in"
												options={voiceOptions}
												bind:value={startChoice}
											/>
										</span>
										<button
											onclick={() => void start(entry)}
											disabled={busy}
											class="btn btn-primary">Start in {startIn.name}</button
										>
									{:else}
										<!-- Never a button that will fail (errors.md): said, not
										     hovered. -->
										<span class="text-muted text-xs"
											>This crew has no voice channel you can start it in.</span
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
	>
		{#snippet where()}
			<!-- Where it runs, chosen with what and when (#2572): it used to be a
			     line on the page behind the picker, set before opening it. -->
			{#if voice.length > 0}
				<div class="w-48">
					<span class="eyebrow">where</span>
					<div class="mt-1">
						<Select
							label="voice channel"
							options={channelOptions}
							bind:value={planChannel}
						/>
					</div>
				</div>
			{/if}
		{/snippet}
	</SessionPicker>
{/if}
