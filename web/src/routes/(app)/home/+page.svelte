<script lang="ts">
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Plus from '@lucide/svelte/icons/plus';
	import Radio from '@lucide/svelte/icons/radio';
	import User from '@lucide/svelte/icons/user';
	import { account, unchosen } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { presence } from '$lib/presence.svelte';
	import { friends, friendsAround } from '$lib/friends/friends.svelte';
	import FriendsAround from '$lib/friends/FriendsAround.svelte';
	import { aroundNow, namedInCards } from '$lib/home/around-now';
	import { weekTotals } from '$lib/ride/week';
	import { page } from '$app/state';
	import StartOrJoin from '$lib/home/StartOrJoin.svelte';
	import AroundNow from '$lib/home/AroundNow.svelte';
	import FirstRun from '$lib/home/FirstRun.svelte';
	import RecentRides from '$lib/home/RecentRides.svelte';
	import ThisWeek from '$lib/home/ThisWeek.svelte';
	import type { ServerRide } from '$lib/ride/list';
	import Modal from '$lib/components/Modal.svelte';
	import { leadsWithJoining } from '$lib/nav/crews';
	import { levelFromXp, levelProgress, xpForLevel } from '$lib/level';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import MarkIcon from '$lib/components/MarkIcon.svelte';
	import { fetchProgression, type LoadSummary } from '$lib/progression';
	import Banner from '$lib/components/Banner.svelte';
	import DesktopNotice from '$lib/components/DesktopNotice.svelte';
	import RecoveredNotice from '$lib/ride/RecoveredNotice.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { crewLive } from '$lib/nav/crew-live.svelte';
	import RideDoors from '$lib/ride/RideDoors.svelte';
	import { doorsFor } from '$lib/crew-lounge';
	import { goto } from '$app/navigation';
	import { sessionPath } from '$lib/channel/address';

	// Home (#212): the between-rides overview — who is around, what is
	// planned, your friends, your week. ADR-0020 folded /sessions in here;
	// the sidebar is the list of crews and their channels. It reads top-down
	// (#3688): the greeting, one action row, the set-up card while steps
	// remain, four tiles, then the week beside who is around and your rides.

	void account.load();

	let rides = $state<ServerRide[] | null>(null);
	let ridesError = $state<string | null>(null);
	// Either read failing is said here with a Retry (errors.md): the rides
	// read used to fail silently into "0 rides this week", and a failed
	// crew read into "start your first" (audit 2026-09-09).
	const error = $derived(ridesError ?? presence.error);
	let form = $state<LoadSummary | null>(null);

	// The shell's presence store is the crew list, re-fetched on every lobby
	// ping (#251). Home used to fetch it again, so each ping cost two
	// identical requests. A first read that failed is not an empty list: the
	// page waits with the banner.
	const ready = $derived(
		presence.loaded && !(presence.error && presence.crews.length === 0),
	);
	$effect(() => {
		if (!account.loaded || !account.me) return;
		void fetchProgression().then((res) => {
			// Decorative context — on failure the form line simply stays away.
			// Hidden through the SPEC cold start: numbers first, opinions once
			// they mean something.
			if (res.ok && res.data?.load && !res.data.load.building)
				form = res.data.load;
		});
		void loadRides();
	});
	async function loadRides() {
		const res = await api<{ rides: ServerRide[] }>('/api/rides');
		if (res.ok) {
			rides = res.data.rides;
			ridesError = null;
		} else ridesError = res.error.message;
	}
	function retry() {
		if (presence.error) presence.reload();
		if (ridesError) void loadRides();
	}

	// ── You, in numbers ───────────────────────────────────────────────────────
	// FTP and level are the two numbers riders check on the way in; the level
	// is lifetime, FTP is what tonight's targets scale from.
	const xp = $derived(account.me?.totalXp ?? 0);
	const level = $derived(levelFromXp(xp));
	const toNext = $derived(Math.max(0, xpForLevel(level + 1) - xp));
	// The number nobody chose must not read as one somebody measured (#1484).
	// An account is created holding 200 W and 75 kg, and this tile printed
	// them in the same display type, with the same authority, as a
	// ramp-measured FTP — under which every FTP-relative target, the
	// execution score, the XP bonus, the category and the load were scaled
	// (docs/SPEC.md). While the source says nobody chose it, the tile says so
	// too, and the first-run card above is where it gets answered.
	const guessedFtp = $derived(!!account.me && unchosen(account.me.ftpSource));
	// w/kg is two guesses divided by each other — a fiction with a decimal
	// point. It waits until at least one of the pair is the rider's own.
	const wkgNow = $derived(
		account.me &&
			account.me.weightKg > 0 &&
			!(unchosen(account.me.ftpSource) && unchosen(account.me.weightSource))
			? (account.me.ftpWatts / account.me.weightKg).toFixed(1)
			: null,
	);

	// Friends who are around right now — the channels above answer "where", this
	// answers "who" (ADR-0012: presence, never watts).
	// The friends the app already keeps (#1740): this page used to fetch its
	// own copy on every ping — and filter it on a status the server never
	// sends, so the row never rendered for anyone.
	// Named once (#2882 L6-11): a friend standing in a voice channel is in its
	// card in Around right now, so the chips are the friends who are not.
	const inCards = $derived(
		namedInCards(aroundNow(crewLive.crews, account.me?.id ?? '')),
	);
	const friendsOnline = $derived(
		friendsAround(friends.list ?? []).filter((f) => !inCards.has(f.id)),
	);

	const recent = $derived((rides ?? []).slice(0, 3));
	// Sent to a door and not through it: the one predicate the button's word,
	// this dialog's name and the sheet's order all read (#2176, #2184). Gated
	// on `presence.loaded` so none of the three says "join" while the list is
	// still out.
	const joinFirst = $derived(
		presence.loaded &&
			leadsWithJoining(presence.crews, account.me?.pendingInvite),
	);

	// The rider's own crew, for the first-run card (#1333); null until the
	// crew list has landed, so the card never flashes for a rider who has
	// no crew to set up.
	const ownCrew = $derived.by(() => {
		if (!ready) return null;
		const crews = presence.crews;
		// The one founded for you (#1928), before any you were handed.
		return (
			crews.find((c) => c.founded) ??
			crews.find((c) => c.role === 'owner') ??
			null
		);
	});
	// "Start a crew" opens the same sheet the sidebar's + does outside a crew
	// the rider keeps (#1199, #1333, #2480) — on Home's own body, because the
	// drawer the sidebar lives in below md is translated off-screen and takes
	// a dialog inside it along. It is Home's one way into a crew (#3688):
	// a second copy of the forms in a column of their own offered "Start a
	// crew" three times.
	let opening = $state(false);
	const crewless = $derived(ready && presence.crews.length === 0);
	// Planning happens on a crew's Schedule (#2440), and every member plans:
	// the crews you are in are where the button goes, the main one first
	// (#2144). None yet: start or join one first (#2511).
	const plannable = $derived.by(() => {
		const main = account.me?.homeCrewId;
		return [...presence.crews].sort((a, b) =>
			a.id === main ? -1 : b.id === main ? 1 : 0,
		);
	});
	const firstCrew = $derived(plannable[0]);

	const greeting = $derived.by(() => {
		const h = new Date().getHours();
		return h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
	});
	const minutesIn = (sec: number) => {
		const min = Math.round(sec / 60);
		return min < 1
			? 'just starting'
			: `${min} minute${min === 1 ? '' : 's'} in`;
	};
	// A session running in one of your crews' voice channels (#2450): the
	// sidebar's read, which is live on every page.
	const running = $derived(
		crewLive.crews
			.flatMap((crew) => crew.channels.map((channel) => ({ crew, channel })))
			.find(({ channel }) => channel.session),
	);
	// One sentence and one button: the session that is riding, else nothing
	// — a hero with nowhere to go is noise.
	const headline = $derived.by(() => {
		const session = running?.channel.session;
		if (running && session)
			return {
				// A ride is joined where the numbers are (#1332): the session's
				// own page, which joins no voice by itself.
				href: sessionPath(running.crew.id, session.id),
				text: `${running.channel.name} is riding right now — ${minutesIn(session.elapsed)}.`,
				cta: 'Join the ride',
			};
		return null;
	});
	const week = $derived(weekTotals(rides ?? []));

	// The two doors (#3274): alone, or where the crew can drop in. They are
	// the action row's ride; with no lounge to offer, the alone door stands
	// by itself.
	const doors = $derived(doorsFor(crewLive));
	// The action row has exactly one filled button (TARGETS home 4): the
	// ride that is on; before the first crew, the crew (ADR-0010); else the
	// door this rider takes; else the alone door, standing by itself.
	const filled = $derived<'join' | 'crew' | 'door' | 'alone' | null>(
		headline
			? 'join'
			: crewless
				? 'crew'
				: doors
					? 'door'
					: ready
						? 'alone'
						: null,
	);
	const skin = (which: typeof filled) =>
		filled === which ? 'btn-primary' : 'btn-secondary';

	// A deep link to the forms — the directory's empty state, a shared
	// /home#crews — opens them once the page is up (#1199).
	$effect(() => {
		// The sheet asks the crew list which form leads; before that it
		// stays shut. #sessions the same way (#1862): the old /sessions
		// redirect landed on the top, because the section it named was behind
		// the same fetch when the hash was applied.
		if (!ready) return;
		if (page.url.hash === '#crews') opening = true;
		else if (page.url.hash === '#sessions')
			queueMicrotask(() =>
				document.getElementById('sessions')?.scrollIntoView({ block: 'start' }),
			);
	});
</script>

<svelte:head><title>Home · WattRoom</title></svelte:head>

<main class="page">
	<!-- The mock's header (ADR-0020): a greeting, one sentence on what is
	     happening, and the one thing to do about it. Home is the between-
	     rides surface, so the first thing it says is where the ride is. -->
	<h1 class="page-title">
		{greeting}, {account.me?.displayName?.split(' ')[0] ?? 'rider'}.
	</h1>
	{#if headline}
		<p class="text-muted mt-1 text-sm">{headline.text}</p>
	{/if}
	<!-- One action row (#3688): ride, plan, a crew, in that order on every
	     visit, each 44 px (a phone on the bars), one of them filled. The
	     filled one takes a clear border so it stands as tall as the rest.
	     The row is shared out, never left ragged: each door wide enough for
	     its label on one line, the rest alike. Where the column is too narrow
	     for that (a container query: the sidebar takes its share), two to a
	     row, the doors a row of their own. -->
	<div class="@container mt-4">
		<div
			class="grid grid-cols-2 items-start gap-3 @5xl:flex @5xl:gap-x-6 [&_.btn-primary]:border [&_.btn-primary]:border-transparent [&>*]:@5xl:flex-[3_1_0%]"
			data-testid="home-actions"
		>
			{#if headline}
				<a href={headline.href} class="btn btn-primary btn-lg col-span-2"
					><Radio size={15} /> {headline.cta}</a
				>
			{/if}
			{#if doors}
				<RideDoors
					onAlone={() => void goto('/ride?alone')}
					lead={filled === 'door'}
					class="col-span-2 min-w-0 @5xl:!flex-[11_1_0%]"
				/>
			{:else}
				<!-- The alone door, by the doors' own name, where there is no
			     lounge to offer beside it. -->
				<a href="/ride?alone" class="btn btn-lg {skin('alone')}"
					><User size={15} /> Ride alone</a
				>
			{/if}
			{#if plannable.length > 1}
				<!-- More than one crew to plan in: ask, never guess (#435). -->
				<details class="relative">
					<summary
						class="btn btn-secondary btn-lg w-full cursor-pointer list-none [&::-webkit-details-marker]:hidden"
						><CalendarClock size={15} /> Plan a session</summary
					>
					<ul class="panel absolute top-full left-0 z-20 mt-1 min-w-56 py-1">
						{#each plannable as crew (crew.id)}
							<li>
								<a
									href="/crew/{crew.id}/schedule?plan"
									class="hover:bg-surface flex items-center gap-2 px-3 py-2 text-sm"
								>
									<MarkIcon icon={crew.icon} size={14} />
									<span class="truncate">{crew.name}</span>
								</a>
							</li>
						{/each}
					</ul>
				</details>
			{:else if firstCrew}
				<a
					href="/crew/{firstCrew.id}/schedule?plan"
					class="btn btn-secondary btn-lg"
					><CalendarClock size={15} /> Plan a session</a
				>
			{/if}
			{#if ready}
				<!-- Carrying an invite, the crew button is joining the crew that
			     sent it (#2144, #2184); everyone else is offered the crew the
			     signed-out landing promised, and joining is one step down the
			     same sheet. Filled before the first crew (ADR-0010). -->
				<button
					onclick={() => (opening = true)}
					class="btn btn-lg {skin('crew')}"
					><Plus size={15} />
					{joinFirst ? 'Join a crew' : 'Start a crew'}</button
				>
			{:else if !presence.error}
				<!-- Not "start your first" before the list has said there is none
			     (#2848): a rider with crews was one tap from founding a
			     duplicate while it loaded, and after it failed — when the banner
			     below says why. -->
				<Skeleton class="h-11" />
			{/if}
		</div>
	</div>

	<!-- Its steps read the crew list and the rides; before both have landed
	     it listed steps the rider had already done (#2848). -->
	{#if ready && rides !== null}
		<FirstRun crew={ownCrew} ridden={xp > 0 || recent.length > 0} />
	{/if}

	{#if error}
		<div class="mt-6">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button onclick={retry} class="btn-link text-xs">Retry</button>
				{/snippet}
			</Banner>
		</div>
	{/if}

	<RecoveredNotice />

	<!-- You, in numbers — the band the mock's "your week" grew into: FTP,
	     level, w/kg and the week, one glance. Four equal tiles (v2-summary):
	     an eyebrow, a value in the display face, a muted unit on its
	     baseline at half its size (TARGETS G4). Nothing here needs a click. -->
	<section
		class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
		data-testid="home-tiles"
	>
		<div class="panel">
			<p class="eyebrow">ftp</p>
			<p class="font-display text-2xl font-bold tabular-nums">
				{account.me?.ftpWatts ?? '–'}<span class="text-muted ml-1 text-xs"
					>W</span
				>
			</p>
			{#if wkgNow}
				<p class="text-muted text-[11px] tabular-nums">{wkgNow} w/kg</p>
			{:else if guessedFtp}
				<p class="text-muted text-[11px]">
					a starting guess, not a measurement
				</p>
			{/if}
		</div>
		<!-- The one tile that opens: the level's receipts live in the trophy
		     case (#467). -->
		<a
			href="/u/me"
			class="panel hover:border-muted/40 block"
			title="Your rider page: medals, achievements, where your XP comes from"
		>
			<p class="eyebrow">level · trophies</p>
			<p class="font-display text-2xl font-bold tabular-nums">{level}</p>
			<div class="mt-1.5"><ProgressBar pct={levelProgress(xp) * 100} /></div>
			<p class="text-muted mt-1 text-[11px] tabular-nums">
				{toNext.toLocaleString()} XP to {level + 1}
			</p>
		</a>
		<div class="panel">
			<p class="eyebrow">this week</p>
			{#if rides === null}
				<!-- Not "0 rides" while the list is in flight (#1666). -->
				<Skeleton class="mt-1 h-7 w-20" />
				<Skeleton class="mt-1 h-3 w-24" />
			{:else}
				<p class="font-display text-2xl font-bold tabular-nums">
					{week.count}<span class="text-muted ml-1 text-xs"
						>ride{week.count === 1 ? '' : 's'}</span
					>
				</p>
				<p class="text-muted text-[11px] tabular-nums">
					{week.minutes} min · {week.kj.toLocaleString()} kJ
				</p>
			{/if}
		</div>
		<div class="panel">
			<p class="eyebrow">form</p>
			{#if rides === null}
				<Skeleton class="mt-1 h-7 w-16" />
				<Skeleton class="mt-1 h-3 w-24" />
			{:else if form}
				<p class="font-display text-2xl font-bold tabular-nums">
					{form.formPct > 0 ? '+' : ''}{Math.round(form.formPct)}<span
						class="text-muted ml-1 text-xs">%</span
					>
				</p>
				<p class="text-muted text-[11px]">{form.zone}</p>
			{:else}
				<p class="font-display text-muted text-2xl font-bold">–</p>
				<p class="text-muted text-[11px]">shows after your first month</p>
			{/if}
		</div>
	</section>

	{#if !ready}
		<div class="mt-6 grid gap-8 xl:grid-cols-2">
			{#each { length: 2 } as _, i (i)}
				<div class="border-frame rounded-lg border px-5 py-4">
					<Skeleton class="h-4 w-48" />
					<Skeleton class="mt-2 h-3 w-28" />
				</div>
			{/each}
		</div>
	{:else}
		<!-- Two equal columns on a wide screen (#417, #3688): what is planned
		     on the left; who is around, then what you rode, on the right. One
		     column below xl, in that order. -->
		<div class="mt-6 grid gap-8 xl:grid-cols-2">
			<!-- This week: every planned session, across every crew you are
			     in, under its day (ADR-0020 — /sessions retired into this;
			     #3689). Planning and saying you are in both happen on the
			     Schedule of the crew whose session it is. -->
			<div class="min-w-0">
				<ThisWeek planCrew={firstCrew?.id} />
			</div>
			<div class="min-w-0 space-y-8">
				<!-- Around right now: the reason to open the app — people. -->
				<section>
					<h2 class="eyebrow">Around right now</h2>
					<AroundNow />
					{#if friendsOnline.length > 0}
						<div class="mt-3"><FriendsAround list={friendsOnline} /></div>
					{/if}
				</section>
				<!-- The last few rides: what you did, one line each, the log a click away. -->
				<RecentRides
					rides={recent}
					ondelete={(ride) =>
						(rides = rides?.filter((r) => r.id !== ride.id) ?? null)}
				/>
			</div>
		</div>
	{/if}

	<!-- The desktop app's offer, for a rider in a browser on a desk: last,
	     under the rider's own numbers and week (#3688). What's new and every
	     update moved to the sidebar's update row (#2588). -->
	<DesktopNotice />
</main>

{#if opening}
	<!-- Named for what the rider pressed (#2176): a crewless rider pressed
	     "Join a crew" and the dialog announced itself as "Open a room". -->
	<Modal
		label={joinFirst ? 'Join a crew' : 'Start a crew'}
		onclose={() => (opening = false)}
		class="max-w-sm"
	>
		<StartOrJoin />
	</Modal>
{/if}
