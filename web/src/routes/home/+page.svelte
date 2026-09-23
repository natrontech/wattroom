<script lang="ts">
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import Plus from '@lucide/svelte/icons/plus';
	import Radio from '@lucide/svelte/icons/radio';
	import { account, unchosen } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { presence } from '$lib/presence.svelte';
	import { friendPlace, friends } from '$lib/friends/friends.svelte';
	import { placePath } from '$lib/whereabouts';
	import { revealCrews } from '$lib/home/reveal';
	import { statusOf } from '$lib/status';
	import { page } from '$app/state';
	import StartOrJoin from '$lib/home/StartOrJoin.svelte';
	import AroundNow from '$lib/home/AroundNow.svelte';
	import FirstRun from '$lib/home/FirstRun.svelte';
	import RecentRides from '$lib/home/RecentRides.svelte';
	import WhatsNext from '$lib/home/WhatsNext.svelte';
	import type { ServerRide } from '$lib/ride/list';
	import Modal from '$lib/components/Modal.svelte';
	import { leadsWithJoining } from '$lib/nav/crews';
	import { levelFromXp, levelProgress, xpForLevel } from '$lib/level';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import { fetchProgression, type LoadSummary } from '$lib/progression';
	import Banner from '$lib/components/Banner.svelte';
	import { changelog } from '$lib/changelog.svelte';
	import WhatsNewNotice from '$lib/components/WhatsNewNotice.svelte';
	import DesktopNotice from '$lib/components/DesktopNotice.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { crewLive } from '$lib/nav/crew-live.svelte';
	import { sessionPath } from '$lib/channel/address';

	// Home (#212): the between-rides overview — who is around, what is
	// planned, your friends, your week. ADR-0020 folded /sessions in here;
	// the sidebar is the list of crews and their channels.

	void account.load();
	// What's new (#345). Home is the between-rides surface, which is the only
	// place this belongs — ux.md: never interrupt a rider mid-interval.
	void changelog.load();

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
	const friendsOnline = $derived(
		(friends.list ?? []).filter(
			(f) => f.status === 'accepted' && (f.online || f.inVoice),
		),
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
	// a dialog inside it along.
	let opening = $state(false);
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
	const week = $derived.by(() => {
		const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
		const recent = (rides ?? []).filter(
			(ride) => Date.parse(ride.startedAt) > cutoff,
		);
		return {
			count: recent.length,
			minutes: Math.round(
				recent.reduce((sum, ride) => sum + ride.seconds, 0) / 60,
			),
			kj: Math.round(recent.reduce((sum, ride) => sum + ride.kj, 0)),
		};
	});

	// A deep link to the forms — the directory's empty state, a shared
	// /home#crews — lands on them once the page is up (#1199).
	$effect(() => {
		// The forms render once the crew list has landed; before that there
		// is nothing to reveal. #sessions the same way (#1862): the old
		// /sessions redirect landed on the top, because the section it named
		// was behind the same fetch when the hash was applied.
		if (!ready) return;
		if (page.url.hash === '#crews') queueMicrotask(revealCrews);
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
	<!-- The things you actually come here to do, as buttons rather than as
	     sections to scroll for. The hero is the ride that is on; the rest are
	     always there. -->
	<div class="mt-4 flex flex-wrap items-center gap-2">
		{#if headline}
			<a href={headline.href} class="btn btn-accent btn-lg"
				><Radio size={15} /> {headline.cta}</a
			>
		{/if}
		<!-- Before the first crew, the crew is the big button (ADR-0010,
		     ux.md's empty-state rule): the landing page promised one, and the
		     largest button here used to send them to a workout list instead
		     (audit 2026-09-09). -->
		<a
			href="/workouts"
			class="btn btn-secondary {headline || !presence.crews.length
				? ''
				: 'btn-lg'}"><ChartColumn size={15} /> Ride solo</a
		>
		{#if plannable.length > 1}
			<!-- More than one crew to plan in: ask, never guess (#435). -->
			<details class="relative">
				<summary
					class="btn btn-secondary cursor-pointer list-none [&::-webkit-details-marker]:hidden"
					><CalendarClock size={15} /> Plan a session</summary
				>
				<ul class="panel absolute top-full left-0 z-20 mt-1 min-w-56 py-1">
					{#each plannable as crew (crew.id)}
						<li>
							<a
								href="/crew/{crew.id}/schedule"
								class="hover:bg-surface flex items-center gap-2 px-3 py-2 text-sm"
							>
								<RoomIcon icon={crew.icon} size={14} />
								<span class="truncate">{crew.name}</span>
							</a>
						</li>
					{/each}
				</ul>
			</details>
		{:else if firstCrew}
			<a href="/crew/{firstCrew.id}/schedule" class="btn btn-secondary"
				><CalendarClock size={15} /> Plan a session</a
			>
		{:else}
			<!-- Carrying an invite, the big button is joining the crew that sent
			     it (#2144, #2184); everyone else gets the crew the signed-out
			     landing promised, and joining is one step down the same sheet. -->
			<button
				onclick={() => (opening = true)}
				class="btn {presence.crews.length
					? 'btn-secondary'
					: 'btn-primary btn-lg'}"
				><Plus size={15} />
				{joinFirst ? 'Join a crew' : 'Start a crew'}</button
			>
		{/if}
	</div>

	<FirstRun crew={ownCrew} ridden={xp > 0 || recent.length > 0} />

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

	<!-- One notice at a time (#1333): the first with something to say shows,
	     dismissing it reveals the next. The order is the importance — your new
	     account, the desktop app's update or offer, then what's new — and the
	     queueing is the stylesheet's: every notice renders its own element or
	     nothing at all, so "first child" is "first that has something to say". -->
	<div class="notices">
		<DesktopNotice />
		{#if changelog.unseen}
			<WhatsNewNotice />
		{/if}
	</div>

	<!-- You, in numbers — the band the mock's "your week" grew into: FTP,
	     level, w/kg and the week, one glance. Nothing here needs a click. -->
	<section class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="panel">
			<p class="eyebrow">ftp</p>
			<p class="font-display text-2xl font-bold tabular-nums">
				{account.me?.ftpWatts ?? '–'}<span class="text-muted ml-1 text-sm"
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
					{week.count}<span class="text-muted ml-1 text-sm"
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
					{form.formPct > 0 ? '+' : ''}{Math.round(form.formPct)}%
				</p>
				<p class="text-muted text-[11px]">{form.zone}</p>
			{:else}
				<p class="font-display text-muted text-2xl font-bold">–</p>
				<p class="text-muted text-[11px]">shows after your first month</p>
			{/if}
		</div>
	</section>

	{#if !ready}
		<div class="mt-8 grid gap-3">
			{#each { length: 2 } as _, i (i)}
				<div class="border-muted/15 rounded-lg border px-5 py-4">
					<Skeleton class="h-4 w-48" />
					<Skeleton class="mt-2 h-3 w-28" />
				</div>
			{/each}
		</div>
	{:else}
		<!-- Two columns on a wide screen (#417): what is happening on the left,
		     what you can open or plan on the right — the page fills the column
		     instead of stopping at 48rem. -->
		<div class="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
			<div class="min-w-0 space-y-8">
				<!-- Around right now: the reason to open the app — people. -->
				<section>
					<h2 class="eyebrow">Around right now</h2>
					<AroundNow />
					{#if friendsOnline.length > 0}
						<ul class="mt-3 flex flex-wrap gap-2">
							{#each friendsOnline as friend (friend.id)}
								<li>
									<a
										href={friend.channel
											? placePath(friend.channel)
											: `/messages/dm/${friend.id}`}
										class="panel hover:border-muted/40 flex items-center gap-2 px-2.5 py-1.5 text-xs"
										title={friendPlace(friend)}
									>
										<!-- The badge Avatar draws, from the one vocabulary
										     (#807, $lib/status) — not a mark of this row's
										     own. Home drew RidingBars for anyone `inRoom`,
										     and those bars say "riding now" to the eye and
										     to a screen reader, so a friend chatting in a
										     room was reported as pedalling while the
										     Friends page called the same person "in a
										     room". ADR-0012: presence never implies watts
										     (#2168). -->
										<Avatar
											name={friend.name}
											avatarUrl={friend.avatarUrl}
											xp={friend.totalXp}
											status={statusOf(crewLive.crews, friend.id, friends.list)}
											size={20}
										/>
										<span class="font-medium">{friend.name}</span>
									</a>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<!-- The last few rides: what you did, one line each, the log a click away. -->
				<RecentRides
					rides={recent}
					ondelete={(ride) =>
						(rides = rides?.filter((r) => r.id !== ride.id) ?? null)}
				/>

				<!-- What's next: every planned session, across every room you are
			     in (ADR-0020 — /sessions retired into this). Planning and saying
			     you are in both happen in the room whose session it is. -->
				<WhatsNext planCrew={firstCrew?.id} />
			</div>
			<!-- Friends is its own place (ADR-0020); the heading that stayed here
			     with nothing under it went with #1333. -->
			<aside class="min-w-0 space-y-8">
				<StartOrJoin />
			</aside>
		</div>
	{/if}
</main>

{#if opening}
	<!-- Named for what the rider pressed (#2176): a crewless rider pressed
	     "Join a crew" and the dialog announced itself as "Open a room". -->
	<Modal
		label={joinFirst ? 'Join a crew' : 'Start a crew'}
		onclose={() => (opening = false)}
		class="max-w-sm"
	>
		<StartOrJoin compact />
	</Modal>
{/if}

<style>
	.notices > :global(:not(:first-child)) {
		display: none;
	}
</style>
