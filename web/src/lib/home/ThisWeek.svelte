<script lang="ts">
	// Home's This week (#3689, ADR-0020): every planned session in every crew
	// you are in, under its day, with what is riding now among today's. That
	// cross-crew list is the whole reason /sessions folded in here, one row
	// per session, never one per channel (#1693).
	//
	// No RSVP here, on purpose (decided 2026-09-17). Saying you are in, and
	// who is, belong with the planning on the crew's Schedule; a row carries
	// only the count.
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { presence } from '$lib/presence.svelte';
	import { crewLive } from '$lib/nav/crew-live.svelte';
	import NotifyOffer from '$lib/components/NotifyOffer.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import { byDay, weekList, type Planned, type WeekDay } from './week-list';

	let {
		planCrew,
	}: {
		/** The crew this rider plans in first, for the empty state's CTA and
		 *  the calendar link — absent in no crew, where a feed is of nothing. */
		planCrew?: string;
	} = $props();

	let sessions = $state<Planned[] | null>(null);
	let error = $state<string | null>(null);
	// What lies past the week is one press away, the way the list used to
	// hold the rest past its first eight.
	let all = $state(false);

	async function load() {
		const res = await api<{ sessions: Planned[] }>('/api/schedule');
		if (!res.ok) {
			// A failed read is not an empty calendar (errors.md): whatever list
			// this had stays on screen, and the line says what happened.
			error = res.error.message;
			return;
		}
		error = null;
		sessions = res.data.sessions;
	}

	$effect(() => {
		if (!account.me) return;
		// The lobby ping (#570): planning, moving and cancelling each ping
		// every socket, and those three are exactly what this list shows.
		presence.version;
		void load();
	});

	// The clock is read again with every read the list is drawn from: a plan
	// dims, and a session's start is placed, as of the newest one.
	const now = $derived.by(() => {
		void sessions;
		void crewLive.crews;
		return Date.now();
	});
	const lists = $derived(weekList(sessions ?? [], crewLive.crews, now));
	const days = $derived(
		byDay(all ? [...lists.week, ...lists.later] : lists.week, now),
	);
	// Nothing this week: the first plan after it, under NEXT (TARGETS home 8).
	const next = $derived<WeekDay[]>(
		lists.week.length === 0 && lists.later.length > 0
			? byDay(lists.later.slice(0, 1), now)
			: [],
	);
</script>

{#snippet rows(list: WeekDay[])}
	{#each list as day (day.key)}
		<h3 class="eyebrow mt-4 first:mt-3">{day.label}</h3>
		<ul class="mt-2 space-y-2">
			{#each day.entries as entry (entry.key)}
				<li data-testid="week-row">
					<!-- The whole row is the link (TARGETS home 7): a plan opens its
					     own row on its crew's Schedule (#2608), a session riding now
					     its own page. Past rows draw muted and flat; the rest stand raised. -->
					<a
						href={entry.href}
						class="border-frame flex min-h-11 gap-3 rounded-lg border px-4 py-3 transition-colors {entry.past
							? 'text-muted hover:border-muted/40'
							: 'bg-surface-raised hover:border-muted/40'}"
					>
						<span class="w-14 shrink-0">
							<span
								class="font-display block text-[15px] leading-5 whitespace-nowrap tabular-nums"
								>{entry.time}</span
							>
							{#if entry.period}
								<span class="eyebrow block">{entry.period}</span>
							{/if}
						</span>
						<!-- The count sits right of the row; on a phone, under the
						     title (TARGETS home 9). -->
						<div class="min-w-0 flex-1 sm:flex sm:items-start sm:gap-3">
							<div class="min-w-0 flex-1">
								<p class="eyebrow flex items-center gap-2">
									{#if entry.live}
										<span class="bg-ok size-1.5 shrink-0 rounded-full"></span>
									{/if}
									{entry.kind}{entry.live ? ' · Riding now' : ''}
								</p>
								<p class="mt-1 truncate text-sm font-medium">
									{entry.title}
								</p>
								<p class="text-muted text-xs">{entry.meta}</p>
							</div>
							{#if entry.count}
								<span
									class="text-muted mt-1 block text-xs tabular-nums sm:mt-0 sm:shrink-0"
									>{entry.count}</span
								>
							{/if}
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/each}
{/snippet}

<section id="sessions" data-testid="home-week">
	<h2 class="eyebrow">This week</h2>

	{#if error}
		<p class="text-muted mt-3 text-sm">
			{error}
			<button onclick={() => void load()} class="btn-link ml-1">Retry</button>
		</p>
	{/if}

	{#if sessions === null}
		{#if !error}
			<div class="mt-3 space-y-2">
				{#each { length: 2 } as _, i (i)}
					<div class="border-frame rounded-lg border px-4 py-3">
						<Skeleton class="h-4 w-44" />
						<Skeleton class="mt-1.5 h-3 w-32" />
					</div>
				{/each}
			</div>
		{/if}
	{:else if days.length}
		{@render rows(days)}
		{#if lists.later.length > 0 && lists.week.length > 0}
			<button onclick={() => (all = !all)} class="btn-link mt-2 text-xs">
				{all
					? 'Show this week only'
					: `Show ${lists.later.length} later session${lists.later.length === 1 ? '' : 's'}`}
			</button>
		{/if}
		<!-- Notifications, offered where they would matter (#1485): the rider
		     can see a session is coming, so this is the moment to say the app
		     can tell them when it starts. Once, and only where the button can
		     succeed — NotifyOffer decides. -->
		<NotifyOffer />
	{:else if next.length}
		<p class="text-muted mt-3 text-sm">Nothing planned this week.</p>
		<h3 class="eyebrow mt-4">Next</h3>
		{@render rows(next)}
		<NotifyOffer />
	{:else if !error}
		<p class="text-muted mt-3 text-sm">
			Nothing on the calendar.
			{#if planCrew}
				<!-- The CTA that creates the first one (ux.md), not a word in italics (#1911). -->
				<a href="/crew/{planCrew}/schedule?plan" class="btn-link">Plan one</a> — it
				shows up here, and in everyone's calendar.
			{:else}
				Start or join a crew and plan one on its <em>Schedule</em> — it shows up here,
				and in everyone's calendar.
			{/if}
		</p>
	{/if}

	<!-- The feed is offered under the list it mirrors (ADR-0021 amended, #1374)
	     — once there is a crew to plan in; a subscription to nothing is noise on
	     the screen meant to teach. The link itself lives with the account's
	     other bearer secrets now (#1860), so this is the way to it rather than a
	     second copy of it. -->
	{#if planCrew}
		<a
			href="/settings/data"
			class="panel hover:bg-surface mt-3 flex flex-wrap items-center gap-3 transition-colors"
		>
			<CalendarClock size={15} class="text-muted shrink-0" />
			<span class="text-muted min-w-0 flex-1 text-xs">
				One subscription puts every crew's sessions in your calendar app.
			</span>
			<span class="btn-link shrink-0 text-xs">Get your calendar link</span>
		</a>
	{/if}
</section>
