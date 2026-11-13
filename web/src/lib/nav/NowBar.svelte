<script lang="ts">
	// The now bar: the voice channel you are connected to, along the bottom of
	// the content on every page. Ride, the music and reactions. Voice, Away and
	// Leave sit under your name in the sidebar's foot on a desk, and here while
	// you ride or on a phone, where the sidebar is out of reach. While you ride,
	// the ride's own controls join it (rideBar), on a solo ride with no channel
	// too. It replaced the channel's right column (Shell Rethink): who is here
	// is the stage's tiles and the sidebar's voice rows, the jukebox and the
	// cheers open above this bar.
	import { goto } from '$app/navigation';
	import { nowPanel } from '#lib/nav/now-panel.svelte.ts';
	import { rideBar } from '#lib/nav/ride-bar.svelte.ts';
	import { rideDock } from '#lib/nav/ride-dock.svelte.ts';
	import { rideRoom } from '#lib/channel/ride-room.svelte.ts';
	import AwayLeave from '#lib/nav/AwayLeave.svelte';
	import VoiceControls from '#lib/nav/VoiceControls.svelte';
	import { account, voiceUp } from '#lib/account.svelte.ts';
	import { contextMenu, openMenu } from '#lib/context-menu.svelte.ts';
	import { channelConnection } from '#lib/channel/connection.svelte.ts';
	import { navDrawer } from '#lib/nav/drawer.svelte.ts';
	import { crewLive } from '#lib/nav/crew-live.svelte.ts';
	import { joinSessionPath } from '#lib/channel/address.ts';
	import { startRideTogether } from '#lib/session/crew-session.ts';
	import { device } from '#lib/device.svelte.ts';
	import Bike from '@lucide/svelte/icons/bike';
	import Radio from '@lucide/svelte/icons/radio';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Menu from '@lucide/svelte/icons/menu';
	import Music from '@lucide/svelte/icons/music';
	import SmilePlus from '@lucide/svelte/icons/smile-plus';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeX from '@lucide/svelte/icons/volume-x';

	let { pathname, riding }: { pathname: string; riding: boolean } = $props();

	// The call you are in, and the place your ride is: the crew session you
	// ride, else the call (docs/SESSIONS.md). Voice, the deck and away are the
	// call's; the name, React and Leave are the place's.
	const conn = $derived(channelConnection.call);
	const place = $derived(channelConnection.current);
	const av = $derived(conn?.av);
	// The server has to offer voice at all (#219), and the call server has to
	// be up (#2850): down, Join voice is drawn disabled with the reason.
	const showAv = $derived(!!account.me?.avEnabled && !!conn);
	const voiceDown = $derived(!voiceUp(account.me));
	const onPlace = $derived(channelConnection.onPlacePath(pathname));
	// On a desk the sidebar's foot carries voice, Away and Leave (YouPanel).
	const docked = $derived(!riding && !device.narrow);

	const voiceStatus = $derived(av?.status ?? 'off');
	const inVoice = $derived(voiceStatus === 'live');
	const camOn = $derived(av?.camOn ?? false);
	const handedOff = $derived(av?.handedOff ?? false);
	const voiceError = $derived(av?.error ?? null);
	const playbackBlocked = $derived(av?.playbackBlocked ?? false);
	// Another of your screens carries your voice (ADR-0089): this one moves it.
	const voiceElsewhere = $derived(conn?.live.pairing.elsewhere?.voice ?? '');

	const track = $derived(conn?.live.tick?.jukebox?.current?.title ?? '');
	const notice = $derived(
		showAv &&
			((voiceStatus !== 'off' && (playbackBlocked || handedOff)) ||
				(!!voiceError && !(voiceStatus === 'failed' && onPlace))),
	);

	// Ride is the device's free ride; its arrow starts a session of the
	// crew's own, or joins one that runs (docs/SESSIONS.md). Starting asks the
	// picker on the call's page; the session is the crew's, never the call's.
	// A phone has no trainer, so neither (#412). Off a session only: one ride.
	const canStart = $derived(!channelConnection.session);
	const running = $derived(
		crewLive.crews.find((c) => c.id === conn?.address.crew)?.sessions ?? [],
	);
	const rideItems = () => [
		{
			label: 'Start a session',
			icon: Radio,
			onSelect: () => {
				nowPanel.ask = 'session';
				if (!onPlace && conn) void goto(conn.address.home);
			},
		},
		{
			label: 'Ride together',
			icon: Bike,
			onSelect: () => {
				if (!conn) return;
				const crew = conn.address.crew;
				void startRideTogether(crew).then((res) => {
					if (res.ok) void goto(joinSessionPath(crew, res.data.id));
				});
			},
		},
		...running.map((session) => ({
			label: `Join ${session.workout} · ${session.riders.length} riding`,
			icon: Bike,
			onSelect: () => {
				if (conn) void goto(joinSessionPath(conn.address.crew, session.id));
			},
		})),
	];

	// One panel open at a time, drawn by the channel's shell. Off the channel,
	// the music button goes to it and opens there.
	function toggle(which: 'music' | 'react') {
		nowPanel.open = nowPanel.open === which ? null : which;
		if (!onPlace && conn && nowPanel.open) void goto(conn.address.home);
	}

	// Floating chrome (the jukebox dock) keeps clear of the bar.
	function publishHeight(node: HTMLElement) {
		const root = document.documentElement.style;
		const ro = new ResizeObserver(() =>
			root.setProperty('--now-bar-h', `${node.offsetHeight}px`),
		);
		ro.observe(node);
		return () => {
			ro.disconnect();
			root.removeProperty('--now-bar-h');
		};
	}

	const ICON =
		'grid h-11 w-11 shrink-0 place-items-center rounded hover:bg-ink/5';
</script>

{#if place || rideBar.on}
	<div {@attach publishHeight} data-testid="now-bar" class="relative shrink-0">
		{#if notice}
			<!-- Above the bar, so the bar keeps the sidebar foot's height. -->
			<div
				class="bg-surface border-ink/10 absolute inset-x-0 bottom-full flex flex-col gap-1 border-t px-3 py-1.5"
			>
				{#if showAv && voiceStatus !== 'off' && playbackBlocked}
					<!-- The browser refused to start audio with no gesture behind it
			     (#645). Persistent: read a minute later from three metres. -->
					<div class="text-muted flex items-center gap-2 text-xs">
						<VolumeX size={14} class="shrink-0" />
						<span class="min-w-0 flex-1">You cannot hear the call.</span>
						<button
							onclick={() => void av?.startPlayback()}
							class="btn btn-secondary btn-xs shrink-0">Let me hear</button
						>
					</div>
				{/if}
				{#if showAv && voiceError && !(voiceStatus === 'failed' && onPlace)}
					<!-- What the browser refused and where to allow it (#642). -->
					<div class="flex items-center gap-2 text-xs">
						<span class="text-danger min-w-0 flex-1">{voiceError.message}</span>
						{#if voiceError.signIn}
							<a href="/login" class="btn btn-secondary btn-xs shrink-0"
								>Sign in</a
							>
						{/if}
					</div>
				{/if}
				{#if showAv && voiceStatus !== 'off' && handedOff}
					<div class="text-muted flex items-center gap-2 text-xs">
						<span class="min-w-0 flex-1"
							>Your mic and camera moved to the voice channel open in another
							tab.</span
						>
						<button
							onclick={() => av?.takeOver()}
							class="btn btn-secondary btn-xs shrink-0"
							>Use this tab instead</button
						>
					</div>
				{/if}
			</div>
		{/if}

		<!-- 4rem, the sidebar foot's height, so the two top borders meet. -->
		<div
			class="border-ink/10 bg-surface flex h-[calc(4rem+var(--safe-bottom))] items-center gap-1 border-t px-2 pb-(--safe-bottom) md:gap-2 md:px-3"
		>
			{#if riding}
				<!-- The ride hides the sidebar at every width; this is the way back
				     to it. -->
				<button
					onclick={() => (navDrawer.open = true)}
					class="{ICON} text-muted hover:text-ink"
					aria-label="open navigation"
					aria-expanded={navDrawer.open}><Menu size={18} /></button
				>
			{/if}

			<!-- Where you are connected, and the way back to it from any page.
			     A phone riding gives its room to the ride's controls; the
			     drawer still leads back. -->
			{#if place}<a
					href={place.address.home}
					class="hover:bg-ink/5 flex min-w-0 shrink-[8] items-center gap-2 rounded px-2 py-1 {rideBar.on
						? 'max-sm:hidden'
						: ''}"
					title="Back to {place.address.name}"
					aria-label="Back to the voice channel {place.address.name}"
					onclick={(event) => {
						// Your ride stays on screen: the room opens under its numbers.
						if (!rideRoom.offered) return;
						event.preventDefault();
						rideRoom.on = true;
					}}
				>
					<Volume2
						size={16}
						class="shrink-0 {inVoice ? 'text-ok' : 'text-muted'}"
					/>
					<span class="min-w-0">
						<span class="block truncate text-sm font-medium"
							>{place.address.name}</span
						>
						<span class="text-muted block truncate text-[11px] max-sm:hidden">
							{#if voiceStatus === 'live'}
								<span class="text-ok">in voice</span>{camOn
									? ' · camera on'
									: ''}
							{:else if voiceStatus === 'connecting'}
								joining voice…
							{:else if voiceStatus === 'reconnecting'}
								<span class="text-warn">voice reconnecting…</span>
							{:else if voiceStatus === 'failed'}
								<span class="text-danger">voice failed</span>
							{:else if voiceElsewhere}
								your voice is on your {voiceElsewhere}
							{:else if voiceDown}
								voice is down on this server
							{:else}
								connected, not in voice
							{/if}
						</span>
					</span>
				</a>{/if}

			{#if showAv && !docked}
				<VoiceControls {riding} />
			{/if}

			{#if rideBar.on}
				<!-- One row of 44 px controls, the riding surface's (rideBar); a
				     phone scrolls it sideways. -->
				<div
					bind:this={rideBar.target}
					data-testid="ride-controls"
					style="scrollbar-width:none"
					class="flex min-w-0 flex-auto items-center gap-1.5 overflow-x-auto [&_.btn]:px-2.5 [&_.btn]:text-base [&_button]:shrink-0"
				></div>
			{/if}

			{#if place}<div class="ml-auto flex shrink-0 items-center gap-1">
					{#if conn && !riding && !device.spectator && pathname !== conn.address.training}
						<div class="flex">
							<a
								href={conn.address.training}
								{@attach contextMenu(() => (canStart ? rideItems() : []))}
								class="btn btn-secondary min-h-11 {canStart
									? 'rounded-r-none'
									: ''}"
								title="A free ride in {conn.address.name}"
								><Bike size={14} /> <span class="max-md:sr-only">Ride</span></a
							>
							{#if canStart}
								<button
									onclick={(event) => {
										const box = event.currentTarget.getBoundingClientRect();
										openMenu(
											rideItems(),
											box.right,
											box.top,
											event.currentTarget,
										);
									}}
									aria-label="More ways to ride"
									aria-haspopup="menu"
									class="btn btn-secondary min-h-11 rounded-l-none px-2"
									><ChevronDown size={14} /></button
								>
							{/if}
						</div>
					{:else if riding && !rideBar.on}
						<a
							href={rideDock.screen}
							data-testid="back-to-ride"
							class="btn btn-secondary min-h-11"
							><Bike size={14} /> Back to ride</a
						>
					{/if}
					<!-- No jukebox mid-ride on a phone (#4347), on its side too:
					     a 390 px tall screen has no room for the pop-up and the
					     player both. 30rem is above every phone held sideways
					     and below every tablet and desk window. -->
					{#if conn}<button
							bind:this={nowPanel.music}
							onclick={() => toggle('music')}
							aria-expanded={nowPanel.open === 'music'}
							aria-haspopup="dialog"
							class="hover:bg-ink/5 flex h-11 max-w-56 min-w-0 shrink items-center gap-2 rounded px-2 text-sm {rideBar.on
								? 'max-sm:hidden [@media(max-height:30rem)]:hidden'
								: ''} {nowPanel.open === 'music'
								? 'text-ink bg-ink/5'
								: 'text-muted'}"
							title={track ? `Playing: ${track}` : 'The jukebox'}
							><Music size={18} class="shrink-0" /><span
								class="truncate {rideBar.on ? 'sr-only' : 'max-lg:sr-only'}"
								>{track || 'Music'}</span
							></button
						>{/if}
					{#if onPlace}
						<button
							bind:this={nowPanel.react}
							onclick={() => toggle('react')}
							aria-expanded={nowPanel.open === 'react'}
							aria-haspopup="dialog"
							class="{ICON} {rideBar.on
								? 'max-sm:hidden'
								: ''} {nowPanel.open === 'react'
								? 'text-ink bg-ink/5'
								: 'text-muted hover:text-ink'}"
							title="Cheers and the soundboard"
							aria-label="cheers and the soundboard"
							><SmilePlus size={18} /></button
						>
					{/if}
					{#if !docked}<AwayLeave />{/if}
				</div>{/if}
		</div>
	</div>
{/if}
