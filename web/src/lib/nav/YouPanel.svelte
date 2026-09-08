<script lang="ts">
	// The AV chain is a store, so this reads it rather than being handed
	// fifteen values through a Sidebar that uses none of them (#1047). Same
	// pattern as RoomSensorOverview and lib/profile/VoiceAudio.
	import { goto } from '$app/navigation';
	import Avatar from '$lib/components/Avatar.svelte';
	import QuickAudio from '$lib/room/QuickAudio.svelte';
	import { account } from '$lib/account.svelte';
	import { contextMenu, MENU_HINT } from '$lib/context-menu.svelte';
	import { activeHref } from '$lib/nav/pages';
	import { youMenu } from '$lib/nav/you-menu';
	import { micMenu } from '$lib/room/mic-menu';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { statusOfRider } from '$lib/status';
	import Coffee from '@lucide/svelte/icons/coffee';
	import Headphones from '@lucide/svelte/icons/headphones';
	import LogOut from '@lucide/svelte/icons/log-out';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import Mic from '@lucide/svelte/icons/mic';
	import MicOff from '@lucide/svelte/icons/mic-off';
	import ScreenShare from '@lucide/svelte/icons/screen-share';
	import ScreenShareOff from '@lucide/svelte/icons/screen-share-off';
	import Settings from '@lucide/svelte/icons/settings';
	import Video from '@lucide/svelte/icons/video';
	import VideoOff from '@lucide/svelte/icons/video-off';

	// The route is the one thing the store cannot answer.
	let { pathname }: { pathname: string } = $props();

	const conn = $derived(roomConnection.current);
	const av = $derived(conn?.av);
	// A room open at all is what the panel's connected shape keys on — the
	// same condition the layout used to branch on before it stopped needing to.
	const connectedSlug = $derived(conn?.slug ?? '');
	// Both halves, and the connection half is the one that is easy to lose:
	// the server has to offer voice at all (#219, an account fact), AND there
	// has to be a room to join. The layout used to supply the second by only
	// passing `showAv` from its connected branch — read the account alone here
	// and "Join voice" renders with nothing to join, which is the dead control
	// ux.md forbids.
	const showAv = $derived(!!account.me?.avEnabled && !!conn);

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
	/** The browser muted this tab and the room went silent (#645). */
	const playbackBlocked = $derived(av?.playbackBlocked ?? false);

	const onJoin = () => void av?.join();
	const onMic = () => av?.toggleMic();
	const onCam = () => av?.toggleCam();
	const onShare = () => void av?.toggleShare();
	const onLeaveVoice = () => av?.leave();
	const onTakeOver = () => av?.takeOver();
	// The CONNECTION's setAway, never av's: it mutes this device AND tells the
	// room over the socket, and only the pair of them is "away". av.setAway
	// alone would go quiet without anyone being told.
	const onAway = (next: boolean) => conn?.setAway(next);

	const destination = $derived(activeHref(pathname));
	// The dot on your own avatar: away is yours to set, riding is the room's
	// to report (#1016).
	const myStatus = $derived(
		connectedSlug
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

<!-- You, pinned. The same shape whatever the CONNECTION state — the nav
     above never jumps (rider report: the height flicker read as broken).
     In a room the AV controls get a row of their own: six icons crowded in
     beside a name left a 240 px column nothing to put the name in, and
     these are tapped from a bike (ux.md). -->
<div
	class="border-ink/5 border-t px-3 py-2.5"
	{@attach contextMenu(() => youMenu(account.me?.id, goto))}
>
	<div class="flex items-center gap-2" title={MENU_HINT}>
		<!-- Your own rider page (#575). Everywhere else in the app an avatar
		     opens /u/<id>; yours was the one that did not, and the gear
		     beside it goes to settings — which are titled "Profile". -->
		<a
			href={account.me ? `/u/${account.me.id}` : undefined}
			class="mr-auto flex min-w-0 items-center gap-2"
			title="your rider page"
		>
			<Avatar
				name={account.me?.displayName ?? ''}
				avatarUrl={account.me?.avatarUrl}
				preset={account.me?.avatarPreset}
				xp={account.me?.totalXp}
				status={myStatus}
				size={26}
			/>
			<span class="min-w-0">
				<span class="block truncate text-xs font-medium"
					>{account.me?.displayName ?? ''}</span
				>
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
			href="/profile"
			class="grid h-11 w-11 place-items-center rounded md:h-7 md:w-7 {destination ===
				undefined && pathname.startsWith('/profile')
				? 'text-ink'
				: 'text-muted hover:bg-ink/5 hover:text-ink'}"
			title="settings"
			aria-label="settings"><Settings size={16} /></a
		>
	</div>
	{#if showAv}
		<div class="mt-2 flex items-center gap-1">
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
						class="btn btn-primary btn-xs flex-1"
						><Headphones size={13} />
						{voiceStatus === 'failed'
							? 'Try voice again'
							: 'Join voice'}</button
					>
				{/if}
				<QuickAudio compact />
			{:else}
				<!-- Voice, camera, screen, sound and the way out — here and
				     nowhere else. The people column and the lounge header each
				     drew their own copy of a row the rider already has pinned
				     in front of them. -->
				<!-- How you transmit belongs to the mic, not to a panel (#914).
				     The threshold does not follow it here: that slider IS the
				     meter, so the menu offers the way to it instead. -->
				<button
					onclick={() => onMic?.()}
					class="flex flex-1 justify-center rounded py-1.5 {micOn
						? 'text-z4'
						: 'text-danger'}"
					title="{micOn ? 'mute' : 'unmute'} · {MENU_HINT}"
					aria-label={micOn ? 'mute microphone' : 'unmute microphone'}
					{@attach contextMenu(() => {
						const voice = roomConnection.current?.av;
						return voice ? micMenu(voice, () => onMic?.()) : [];
					})}
				>
					{#if micOn}<Mic size={16} />{:else}<MicOff size={16} />{/if}
				</button>
				<button
					onclick={() => onCam?.()}
					class="flex flex-1 justify-center rounded py-1.5 {camOn
						? 'text-z4'
						: 'text-muted/50 hover:text-muted'}"
					title={camOn ? 'turn camera off' : 'turn camera on'}
					aria-label={camOn ? 'turn camera off' : 'turn camera on'}
				>
					{#if camOn}<Video size={16} />{:else}<VideoOff size={16} />{/if}
				</button>
				<!-- Sharing takes the danger token, like the mic does when it is
			     muted (#563): a state you might not have noticed, and the one
			     that can put a private tab on the stage. Chrome, so the token
			     and not a glow — ADR-0005 keeps those for live data. -->
				<button
					onclick={() => onShare?.()}
					class="flex flex-1 justify-center rounded py-1.5 {sharing
						? 'bg-danger/15 text-danger'
						: 'text-muted/50 hover:text-muted'}"
					title={sharing ? 'stop sharing your screen' : 'share your screen'}
					aria-label={sharing
						? 'stop sharing your screen'
						: 'share your screen'}
				>
					{#if sharing}<ScreenShareOff size={16} />{:else}<ScreenShare
							size={16}
						/>{/if}
				</button>
				<QuickAudio compact />
				<button
					onclick={() => onLeaveVoice?.()}
					class="text-muted/50 hover:text-danger flex flex-1 justify-center rounded py-1.5"
					title="leave voice"
					aria-label="leave voice"><LogOut size={16} /></button
				>
			{/if}
		</div>
	{/if}
	{#if connectedSlug}
		<!-- Away used to sit in the Lounge header, where it read as a room
		     control and was off-screen from every other place (#807). It is
		     the same kind of statement the mic is, so it lives where the mic
		     does — a labelled row of its own, because a bare cup squeezed in
		     beside "Join voice" left both of them fighting for 240 px. No
		     LiveKit needed: it renders on a server with voice switched
		     off. -->
		<button
			onclick={() => onAway?.(!away)}
			aria-pressed={away}
			class="btn btn-xs mt-2 w-full {away ? 'btn-primary' : 'btn-secondary'}"
			><Coffee size={13} /> {away ? "I'm back" : 'Away'}</button
		>
	{/if}
	{#if showAv && playbackBlocked}
		<!-- The room is playing and this rider can hear none of it: the browser
		     refused to start audio with no gesture behind it, and once the
		     voices run through the bus there is nothing else making a sound
		     (#645). One press fixes it for the session.

		     Quiet chrome, the same shape the jukebox already uses for the same
		     refusal — this is not an error the rider made, and magenta means
		     live data (ADR-0005). Persistent, because it is read a minute
		     later from three metres away (errors.md). -->
		<div
			class="border-ink/10 text-muted mt-2 flex items-center gap-2 rounded border px-2 py-1.5 text-[11px]"
		>
			<VolumeX size={13} class="shrink-0" />
			<span class="min-w-0 flex-1">You cannot hear the room.</span>
			<button
				onclick={() => void av?.startPlayback()}
				class="btn btn-secondary btn-xs shrink-0">Let me hear</button
			>
		</div>
	{/if}
	{#if showAv && voiceError}
		<!-- The failure itself, not "voice failed" (#642, errors.md): what
		     the browser refused and where to allow it, or that the session
		     is over and the way back is the login page. Persistent like the
		     hand-off below — the next attempt replaces it. -->
		<div class="border-danger/40 mt-2 rounded border px-2 py-1.5">
			<p class="text-muted text-[10px] leading-snug">{voiceError.message}</p>
			{#if voiceError.signIn}
				<a
					href="/login"
					class="border-muted/25 text-muted hover:text-ink mt-1.5 block w-full rounded border px-2 py-1.5 text-center text-[11px]"
					>Sign in</a
				>
			{/if}
		</div>
	{/if}
	{#if showAv && handedOff}
		<!-- Not a toast: the rider went quiet and needs to still be able to
		     read why a minute later, mid-interval (errors.md). -->
		<div class="border-z5/40 mt-2 rounded border px-2 py-1.5">
			<p class="text-muted text-[10px] leading-snug">
				Your mic and camera moved to the room open in another tab.
			</p>
			<button
				onclick={onTakeOver}
				class="border-muted/25 text-muted hover:text-ink mt-1.5 w-full rounded border px-2 py-1.5 text-[11px]"
				>use this tab instead</button
			>
		</div>
	{/if}
</div>
