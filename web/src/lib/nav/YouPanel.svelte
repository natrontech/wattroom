<script lang="ts">
	import { leaveChannel } from '$lib/channel/leave';
	// The AV chain is a store, so this reads it rather than being handed
	// fifteen values through a Sidebar that uses none of them (#1047). Same
	// pattern as TrainerOverview and lib/profile/VoiceAudio.
	import { goto } from '$app/navigation';
	import Avatar from '$lib/components/Avatar.svelte';
	import StatusMark from '$lib/status-line/StatusMark.svelte';
	import QuickAudio from '$lib/channel/QuickAudio.svelte';
	import { account, voiceUp } from '$lib/account.svelte';
	import {
		contextMenu,
		openMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { activeHref } from '$lib/nav/pages';
	import { chosenCrew } from '$lib/nav/chosen-crew.svelte';
	import { friends } from '$lib/friends/friends.svelte';
	import { UNREAD_DOT } from '$lib/messages/unread-marks';
	import { youMenu } from '$lib/nav/you-menu';
	import { micMenu } from '$lib/channel/mic-menu';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { statusOfRider } from '$lib/status';
	import { device } from '$lib/device.svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { AWAY_CHOICES, AWAY_STATES, awayState } from '$lib/away';
	import Headphones from '@lucide/svelte/icons/headphones';
	import LogOut from '@lucide/svelte/icons/log-out';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import Mic from '@lucide/svelte/icons/mic';
	import MicOff from '@lucide/svelte/icons/mic-off';
	import PhoneOff from '@lucide/svelte/icons/phone-off';
	import ScreenShare from '@lucide/svelte/icons/screen-share';
	import ScreenShareOff from '@lucide/svelte/icons/screen-share-off';
	import Settings from '@lucide/svelte/icons/settings';
	import SwitchCamera from '@lucide/svelte/icons/switch-camera';
	import Video from '@lucide/svelte/icons/video';
	import VideoOff from '@lucide/svelte/icons/video-off';

	// The route is the one thing the store cannot answer.
	let { pathname }: { pathname: string } = $props();

	const conn = $derived(channelConnection.current);
	const av = $derived(conn?.av);
	// A voice channel connected at all is what the panel's connected shape
	// keys on — the same condition the layout used to branch on before it
	// stopped needing to.
	const connected = $derived(!!conn);
	// Both halves, and the connection half is the one that is easy to lose: the
	// server has to offer voice at all (#219, an account fact), AND there has to
	// be a voice channel to join. The layout used to supply the second by only
	// passing `showAv` from its connected branch — read the account alone here
	// and "Join voice" renders with nothing to join, which is the dead control
	// ux.md forbids.
	const showAv = $derived(!!account.me?.avEnabled && !!conn);
	// Configured is not up (#2850): with the call server down, Join voice
	// is drawn disabled with the reason, not offered to fail.
	const voiceDown = $derived(!voiceUp(account.me));
	// On the channel's own pages its banner owns a failed join — the reason
	// and the one big button (#2850) — so the reason is not said twice here.
	const onPlace = $derived(channelConnection.onPlacePath(pathname));

	// The way into voice; mic and camera only appear once you are in.
	const voiceStatus = $derived(av?.status ?? 'off');
	const micOn = $derived(av?.micOn ?? false);
	const camOn = $derived(av?.camOn ?? false);
	const sharing = $derived(av?.sharing ?? false);
	const handedOff = $derived(av?.handedOff ?? false);
	/** Why the last voice action failed, until the next one clears it. */
	const voiceError = $derived(av?.error ?? null);
	/** You stepped out (#706) — a statement about YOU, so it lives here. */
	const away = $derived(av?.away ?? false);
	// Which away the voice channel currently has for me — the server's word, so a
	// state set on the phone shows on the desktop. The button's FACE is the plain
	// cup whenever it offers "Away"; it wears the state's glyph only once it has
	// become "I'm back", where it reports rather than promises.
	const myAwayReason = $derived(
		conn?.live.tick?.roster.find((rider) => rider.id === account.me?.id)
			?.awayReason ?? '',
	);
	const awayFace = $derived(awayState(away ? myAwayReason : ''));
	/** The browser muted this tab and the voice channel went silent (#645). */
	const playbackBlocked = $derived(av?.playbackBlocked ?? false);

	const onJoin = () => void av?.join();
	const onMic = () => av?.toggleMic();
	const onCam = () => av?.toggleCam();
	const onFlip = () => av?.flipCam();
	const onShare = () => void av?.toggleShare();
	const onLeaveVoice = () => av?.leave();
	const onTakeOver = () => av?.takeOver();
	// The CONNECTION's setAway, never av's: it mutes this device AND tells the
	// voice channel over the socket, and only the pair of them is "away".
	// av.setAway alone would go quiet without anyone being told.
	const onAway = (next: boolean, reason = '') => conn?.setAway(next, reason);

	// The arrow's menu: the named states, never plain Away — that one is the
	// face, and putting it in the menu too would offer the same thing twice.
	// Same list on right-click, because a control with more than one action
	// gets a context menu (.claude/rules/ux.md) and this one now has four.
	const awayItems = (): MenuEntry[] =>
		AWAY_CHOICES.map((key) => ({
			label: AWAY_STATES[key].label,
			icon: AWAY_STATES[key].icon,
			onSelect: () => onAway(true, key),
		}));

	const destination = $derived(activeHref(pathname));
	// Your Home has news (#2586): WattRoom opens in your crew now, so the
	// card that opens You says when a friend is waiting on your answer. A
	// release you have not read is the update row's, just above (#2588). Not
	// on Home, which lists the request itself.
	const news = $derived(
		pathname !== '/home' && friends.waiting > 0
			? `${friends.waiting} waiting for you to answer`
			: '',
	);
	// The dot on your own avatar: away is yours to set, riding is the voice
	// channel's to report (#1016).
	const myStatus = $derived(
		connected
			? statusOfRider({
					away,
					riding: conn?.live.tick?.roster.find(
						(rider) => rider.id === account.me?.id,
					)?.riding,
				})
			: null,
	);
	const inVoice = $derived(voiceStatus === 'live');
</script>

<!-- You, pinned. The same shape whatever the CONNECTION state — the nav above
     never jumps (rider report: the height flicker read as broken). In a voice
     channel the AV controls get a row of their own: six icons crowded in beside
     a name left a 240 px column nothing to put the name in, and these are
     tapped from a bike (ux.md). -->
<div
	class="border-ink/5 border-t px-3 py-2.5"
	{@attach contextMenu(() => youMenu(goto))}
>
	<div class="flex items-center gap-2" title={MENU_HINT}>
		<!-- You, one click from any crew (#2581): the switcher's You, without
		     opening the switcher — the YOU section that tried to be this
		     listed Workouts twice. Your rider page is Home's level tile and
		     this card's menu. Home's row is the lit one, so this never is. -->
		<a
			href="/home"
			onclick={() => chosenCrew.set('you')}
			class="hover:bg-ink/5 mr-auto -ml-1 flex min-w-0 items-center gap-2 rounded py-0.5 pr-2 pl-1"
			title="you — your own Home, workouts, rides and music"
		>
			<span class="relative shrink-0">
				<Avatar
					name={account.me?.displayName ?? ''}
					avatarUrl={account.me?.avatarUrl}
					xp={account.me?.totalXp}
					status={myStatus}
					size={26}
				/>
				{#if news}
					<span
						class="{UNREAD_DOT} ring-surface absolute -top-0.5 -right-0.5 ring-2"
						title={news}
						data-testid="you-news"
					></span>
					<span class="sr-only">{news}</span>
				{/if}
			</span>
			<span class="min-w-0">
				<span class="flex min-w-0 items-center gap-1 text-xs font-medium">
					<span class="truncate">{account.me?.displayName ?? ''}</span>
					<StatusMark line={account.me?.statusLine} size={12} />
				</span>
				{#if showAv}
					<!-- Away is not repeated here: the avatar wears the mark and
					     the button below says "I'm back" (#807). -->
					<span class="block truncate text-[10px]">
						{#if voiceStatus === 'live'}
							<span class="text-z4">in voice</span>{camOn ? ' · camera on' : ''}
						{:else if voiceStatus === 'connecting'}
							<span class="text-muted">joining voice…</span>
						{:else if voiceStatus === 'reconnecting'}
							<span class="text-z5">voice reconnecting…</span>
						{:else if voiceStatus === 'failed'}
							<span class="text-danger">voice failed</span>
						{:else}
							<span class="text-muted">not in voice</span>
						{/if}
					</span>
				{/if}
			</span>
		</a>
		<!-- Everything that is a setting rather than a destination: profile,
		     sensors, ramp test, devices, the mixer, the gate, the theme. -->
		<a
			href="/settings"
			class="grid h-11 w-11 place-items-center rounded md:h-7 md:w-7 {destination ===
				undefined && pathname.startsWith('/settings')
				? 'text-ink'
				: 'text-muted hover:bg-ink/5 hover:text-ink'}"
			title="Settings"
			aria-label="Settings"><Settings size={16} /></a
		>
	</div>
	{#if showAv}
		<div class="mt-2 flex flex-wrap items-center gap-1">
			{#if !inVoice}
				<!-- The way in is a labelled button, not two greyed icons that
				     only LOOK like a mic and a camera: a control that does
				     something else than it draws is not a control (#437,
				     ux.md). Mic, camera and screen appear once you are in,
				     because that is when they work. -->
				{#if voiceStatus === 'connecting' || voiceStatus === 'reconnecting'}
					<span class="text-muted flex-1 px-1 text-[11px]"
						>{voiceStatus === 'connecting'
							? 'joining voice…'
							: 'reconnecting…'}</span
					>
				{:else}
					<button
						onclick={() => onJoin?.()}
						disabled={voiceDown}
						class="btn btn-primary min-h-11 flex-1"
						><Headphones size={13} />
						{voiceStatus === 'failed'
							? 'Try voice again'
							: 'Join voice'}</button
					>
				{/if}
				<QuickAudio compact />
				{#if voiceStatus !== 'connecting' && voiceStatus !== 'reconnecting'}
					<!-- The promise at the moment of the decision: AV is transit-only
					     (WATTROOM.md) and the mic gates on speech (docs/SPEC.md). Said on
					     the marketing page and in settings, never here — where a rider
					     first opens a microphone into a voice channel (audit
					     2026-09-09). -->
					<p class="text-muted-dim basis-full px-1 text-[10px]">
						{#if voiceDown}
							<!-- Why the button above is off, where the promise would be
							     (#2850): a join now could only fail. -->
							<span class="text-muted"
								>Voice is down on this server right now — it comes back on its
								own.</span
							>
						{:else if device.coarse}
							<!-- The gate would hold the capture open, and a phone plays the
							     call through its earpiece for as long as anything is
							     capturing (`mic-chain.svelte.ts`). So the mic button is the
							     gate here, and the promise says what actually happens. -->
							Never recorded. Tap the mic to talk — while it is open your phone plays
							the call through the earpiece.
						{:else}
							Never recorded. Your mic opens when you speak.
						{/if}
					</p>
				{/if}
			{:else}
				<!-- Voice, camera, screen, sound and the way out — here and
				     nowhere else. The people column and the lounge header each
				     drew their own copy of a row the rider already has pinned
				     in front of them. -->
				<!-- 44 px tall (ux.md's riding floor): muting is the most-pressed
				     mid-ride control in the product, and it was a 28 px strip
				     while the Settings cog two rows up was 44 (audit 2026-09-09). -->
				<!-- How you transmit belongs to the mic, not to a panel (#914).
				     The threshold does not follow it here: that slider IS the
				     meter, so the menu offers the way to it instead. -->
				<button
					onclick={() => onMic?.()}
					class="flex h-11 flex-1 items-center justify-center rounded {micOn
						? 'text-z4'
						: 'text-danger'}"
					title="{micOn ? 'mute' : 'unmute'} · {MENU_HINT}"
					aria-label="microphone"
					aria-pressed={micOn}
					{@attach contextMenu(() => {
						const voice = channelConnection.current?.av;
						return voice ? micMenu(voice, () => onMic?.()) : [];
					})}
				>
					{#if micOn}<Mic size={16} />{:else}<MicOff size={16} />{/if}
				</button>
				<button
					onclick={() => onCam?.()}
					class="flex h-11 flex-1 items-center justify-center rounded {camOn
						? 'text-z4'
						: 'text-muted-dim hover:text-muted'}"
					title={camOn ? 'turn camera off' : 'turn camera on'}
					aria-label="camera"
					aria-pressed={camOn}
				>
					{#if camOn}<Video size={16} />{:else}<VideoOff size={16} />{/if}
				</button>
				<!-- Front or back, on the machines that have both (#2142). Hidden
				     rather than disabled on a desk: one webcam has no other side,
				     and the picker in Sound is still where a second USB camera is
				     chosen. -->
				{#if camOn && device.coarse}
					<button
						onclick={() => onFlip?.()}
						class="text-muted-dim hover:text-muted flex h-11 flex-1 items-center justify-center rounded"
						title="front or back camera"
						aria-label="flip camera"><SwitchCamera size={16} /></button
					>
				{/if}
				<!-- Sharing takes the danger token, like the mic does when it is
			     muted (#563): a state you might not have noticed, and the one
			     that can put a private tab on the stage. Chrome, so the token
			     and not a glow — ADR-0005 keeps those for live data. -->
				<button
					onclick={() => onShare?.()}
					class="flex h-11 flex-1 items-center justify-center rounded {sharing
						? 'bg-danger/15 text-danger'
						: 'text-muted-dim hover:text-muted'}"
					title={sharing ? 'stop sharing your screen' : 'share your screen'}
					aria-label="share screen"
					aria-pressed={sharing}
				>
					{#if sharing}<ScreenShareOff size={16} />{:else}<ScreenShare
							size={16}
						/>{/if}
				</button>
				<QuickAudio compact />
				<!-- A hang-up, not the way out: it drew the same door as Leave
				     below and did something else — you stay in the channel, and
				     riding (#2560). -->
				<button
					onclick={() => onLeaveVoice?.()}
					class="text-muted-dim hover:text-danger flex h-11 flex-1 items-center justify-center rounded"
					title="leave voice — stay in the channel"
					aria-label="leave voice"><PhoneOff size={16} /></button
				>
			{/if}
		</div>
	{/if}
	{#if connected}
		<!-- Away used to sit in the Lounge header, where it read as a channel
		     control and was off-screen from every other place (#807). It is
		     the same kind of statement the mic is, so it lives where the mic
		     does — a labelled row of its own, because a bare cup squeezed in
		     beside "Join voice" left both of them fighting for 240 px. No
		     LiveKit needed: it renders on a server with voice switched
		     off. -->
		<!-- A split button, not a picker (#706): the face is always "Away", so
		     one tap means the same thing on every ride and a sweating thumb
		     never has to read it first. The arrow is the only way to a named
		     state. Coming back collapses to one full-width button — there is
		     nothing to choose about being back. -->
		<div class="mt-2 flex gap-px">
			<button
				onclick={() => onAway?.(!away, '')}
				aria-pressed={away}
				{@attach contextMenu(awayItems)}
				class="btn min-h-11 grow {away ? 'btn-primary' : 'btn-secondary'} {away
					? ''
					: 'rounded-r-none'}"
				><awayFace.icon size={13} /> {away ? "I'm back" : 'Away'}</button
			>
			{#if !away}
				<button
					onclick={(event) => {
						const box = event.currentTarget.getBoundingClientRect();
						openMenu(awayItems(), box.right, box.bottom, event.currentTarget);
					}}
					aria-label="Choose a state"
					aria-haspopup="menu"
					class="btn btn-secondary min-h-11 rounded-l-none px-2"
					><ChevronDown size={13} /></button
				>
			{/if}
			<!-- The way out of where you are (#2447): a room's row used to carry it,
			     and a channel row is a link, not a connection — so it lives with the
			     other things you say about yourself while connected, Discord's
			     disconnect in its voice panel. Quiet on purpose: leaving is
			     re-doable, so it neither confirms nor shouts. Labelled, because
			     a bare door was not found (#2560). -->
			<button
				onclick={leaveChannel}
				class="btn btn-secondary ml-1 min-h-11 px-2"
				title="leave {conn?.address.name ?? 'the channel'}"
				><LogOut size={13} /> Leave</button
			>
		</div>
	{/if}
	{#if showAv && voiceStatus !== 'off' && playbackBlocked}
		<!-- The voice channel is playing and this rider can hear none of it: the
		     browser refused to start audio with no gesture behind it, and once the
		     voices run through the bus there is nothing else making a sound (#645).
		     One press fixes it for the session.

		     Quiet chrome, the same shape the jukebox already uses for the same
		     refusal — this is not an error the rider made, and magenta means
		     live data (ADR-0005). Persistent, because it is read a minute
		     later from three metres away (errors.md). -->
		<div
			class="border-ink/10 text-muted mt-2 flex items-center gap-2 rounded border px-2 py-1.5 text-[11px]"
		>
			<VolumeX size={13} class="shrink-0" />
			<span class="min-w-0 flex-1">You cannot hear the call.</span>
			<button
				onclick={() => void av?.startPlayback()}
				class="btn btn-secondary btn-xs shrink-0">Let me hear</button
			>
		</div>
	{/if}
	{#if showAv && voiceError && !(voiceStatus === 'failed' && onPlace)}
		<!-- The failure itself, not "voice failed" (#642, errors.md): what
		     the browser refused and where to allow it, or that the session
		     is over and the way back is the login page. Persistent like the
		     hand-off below — the next attempt replaces it. -->
		<div class="border-danger/40 mt-2 rounded border px-2 py-1.5">
			<p class="text-muted text-[10px] leading-snug">{voiceError.message}</p>
			{#if voiceError.signIn}
				<a href="/login" class="btn btn-secondary btn-xs mt-1.5 w-full"
					>Sign in</a
				>
			{/if}
		</div>
	{/if}
	{#if showAv && voiceStatus !== 'off' && handedOff}
		<!-- Not a toast: the rider went quiet and needs to still be able to
		     read why a minute later, mid-interval (errors.md). -->
		<div class="border-z5/40 mt-2 rounded border px-2 py-1.5">
			<p class="text-muted text-[10px] leading-snug">
				Your mic and camera moved to the voice channel open in another tab.
			</p>
			<button
				onclick={onTakeOver}
				class="btn btn-secondary btn-xs mt-1.5 w-full"
				>Use this tab instead</button
			>
		</div>
	{/if}
</div>
