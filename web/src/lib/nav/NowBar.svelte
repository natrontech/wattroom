<script lang="ts">
	// The now bar: the voice channel you are connected to, along the bottom of
	// the content on every page. Voice, Away and Leave, the track playing, and
	// the people sheet. It replaced the sidebar foot's voice rows and the
	// channel's right column (Shell Rethink, direction A).
	import { goto } from '$app/navigation';
	import { leaveChannel } from '$lib/channel/leave';
	import QuickAudio from '$lib/channel/QuickAudio.svelte';
	import { account, voiceUp } from '$lib/account.svelte';
	import { contextMenu, openMenu, MENU_HINT } from '$lib/context-menu.svelte';
	import { micMenu } from '$lib/channel/mic-menu';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { peopleFold } from '$lib/channel/people-fold.svelte';
	import { navDrawer } from '$lib/nav/drawer.svelte';
	import { device } from '$lib/device.svelte';
	import { AWAY_CHOICES, AWAY_STATES, awayState } from '$lib/away';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Headphones from '@lucide/svelte/icons/headphones';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Menu from '@lucide/svelte/icons/menu';
	import Mic from '@lucide/svelte/icons/mic';
	import MicOff from '@lucide/svelte/icons/mic-off';
	import Music from '@lucide/svelte/icons/music';
	import PhoneOff from '@lucide/svelte/icons/phone-off';
	import ScreenShare from '@lucide/svelte/icons/screen-share';
	import ScreenShareOff from '@lucide/svelte/icons/screen-share-off';
	import SwitchCamera from '@lucide/svelte/icons/switch-camera';
	import Users from '@lucide/svelte/icons/users';
	import Video from '@lucide/svelte/icons/video';
	import VideoOff from '@lucide/svelte/icons/video-off';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeX from '@lucide/svelte/icons/volume-x';

	let { pathname, riding }: { pathname: string; riding: boolean } = $props();

	const conn = $derived(channelConnection.current);
	const av = $derived(conn?.av);
	// The server has to offer voice at all (#219), and the call server has to
	// be up (#2850): down, Join voice is drawn disabled with the reason.
	const showAv = $derived(!!account.me?.avEnabled && !!conn);
	const voiceDown = $derived(!voiceUp(account.me));
	const onPlace = $derived(channelConnection.onPlacePath(pathname));

	const voiceStatus = $derived(av?.status ?? 'off');
	const inVoice = $derived(voiceStatus === 'live');
	const micOn = $derived(av?.micOn ?? false);
	// A muted mic holds no capture (#4161), so unmuting opens the device again.
	const micStarting = $derived(av?.micStarting ?? false);
	const camOn = $derived(av?.camOn ?? false);
	const sharing = $derived(av?.sharing ?? false);
	const handedOff = $derived(av?.handedOff ?? false);
	const voiceError = $derived(av?.error ?? null);
	const playbackBlocked = $derived(av?.playbackBlocked ?? false);
	const away = $derived(av?.away ?? false);
	// The button wears the state's glyph only once it says "I'm back".
	const myAwayReason = $derived(
		conn?.live.tick?.roster.find((rider) => rider.id === account.me?.id)
			?.awayReason ?? '',
	);
	const awayFace = $derived(awayState(away ? myAwayReason : ''));
	// Another of your screens carries your voice (ADR-0089): this one moves it.
	const voiceElsewhere = $derived(conn?.live.pairing.elsewhere?.voice ?? '');

	const people = $derived(conn?.live.tick?.roster.length ?? 0);
	const track = $derived(conn?.live.tick?.jukebox?.current?.title ?? '');

	// The connection's setAway: it mutes this device and tells the channel.
	const setAway = (next: boolean, reason = '') => conn?.setAway(next, reason);
	const awayItems = () =>
		AWAY_CHOICES.map((key) => ({
			label: AWAY_STATES[key].label,
			icon: AWAY_STATES[key].icon,
			onSelect: () => setAway(true, key),
		}));

	// The sheet lives in the channel's shell, so off the channel the way to it
	// is the channel itself.
	function openSheet() {
		if (onPlace) peopleFold.open = true;
		else if (conn) void goto(conn.address.home);
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

{#if conn}
	<div
		{@attach publishHeight}
		data-testid="now-bar"
		class="border-ink/10 bg-surface shrink-0 border-t px-2 pt-1.5 pb-[calc(0.375rem+var(--safe-bottom))] md:px-3"
	>
		{#if showAv && voiceStatus !== 'off' && playbackBlocked}
			<!-- The browser refused to start audio with no gesture behind it
			     (#645). Persistent: read a minute later from three metres. -->
			<div class="text-muted flex items-center gap-2 px-1 pb-1.5 text-xs">
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
			<div class="flex items-center gap-2 px-1 pb-1.5 text-xs">
				<span class="text-danger min-w-0 flex-1">{voiceError.message}</span>
				{#if voiceError.signIn}
					<a href="/login" class="btn btn-secondary btn-xs shrink-0">Sign in</a>
				{/if}
			</div>
		{/if}
		{#if showAv && voiceStatus !== 'off' && handedOff}
			<div class="text-muted flex items-center gap-2 px-1 pb-1.5 text-xs">
				<span class="min-w-0 flex-1"
					>Your mic and camera moved to the voice channel open in another tab.</span
				>
				<button
					onclick={() => av?.takeOver()}
					class="btn btn-secondary btn-xs shrink-0">Use this tab instead</button
				>
			</div>
		{/if}

		<div class="flex items-center gap-1 md:gap-2">
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

			<!-- Where you are connected, and the way back to it from any page. -->
			<a
				href={conn.address.home}
				class="hover:bg-ink/5 flex min-w-0 shrink items-center gap-2 rounded px-2 py-1"
				title="Back to {conn.address.name}"
			>
				<Volume2
					size={16}
					class="shrink-0 {inVoice ? 'text-ok' : 'text-muted'}"
				/>
				<span class="min-w-0">
					<span class="block truncate text-sm font-medium"
						>{conn.address.name}</span
					>
					<span class="text-muted block truncate text-[11px] max-sm:hidden">
						{#if voiceStatus === 'live'}
							<span class="text-ok">in voice</span>{camOn ? ' · camera on' : ''}
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
			</a>

			{#if showAv}
				<div class="flex items-center">
					{#if !inVoice}
						{#if voiceStatus !== 'connecting' && voiceStatus !== 'reconnecting'}
							<button
								onclick={() =>
									void av?.join(voiceElsewhere ? { take: true } : {})}
								disabled={voiceDown}
								title={voiceDown
									? 'Voice is down on this server right now. It comes back on its own.'
									: device.coarse
										? 'Never recorded. Tap the mic to talk.'
										: 'Never recorded. Your mic opens when you speak.'}
								class="btn {riding
									? 'btn-secondary'
									: 'btn-primary'} min-h-11 whitespace-nowrap"
								><Headphones size={14} />
								<span class="max-sm:sr-only"
									>{voiceElsewhere
										? 'Use this device for voice'
										: voiceStatus === 'failed'
											? 'Try voice again'
											: 'Join voice'}</span
								></button
							>
						{/if}
						<QuickAudio compact />
					{:else}
						<button
							onclick={() => av?.toggleMic()}
							class="{ICON} {micStarting
								? 'text-muted'
								: micOn
									? 'text-ok'
									: 'text-danger'}"
							title="{micStarting
								? 'mic starting'
								: micOn
									? 'mute'
									: 'unmute'} · {MENU_HINT}"
							aria-label="microphone"
							aria-pressed={micOn}
							aria-busy={micStarting}
							{@attach contextMenu(() => {
								const voice = channelConnection.current?.av;
								return voice ? micMenu(voice, () => voice.toggleMic()) : [];
							})}
						>
							{#if micStarting}<span class="text-[10px] leading-none"
									>starting</span
								>{:else if micOn}<Mic size={18} />{:else}<MicOff
									size={18}
								/>{/if}
						</button>
						<button
							onclick={() => av?.toggleCam()}
							class="{ICON} {camOn
								? 'text-ok'
								: 'text-muted-dim hover:text-muted'}"
							title={camOn ? 'turn camera off' : 'turn camera on'}
							aria-label="camera"
							aria-pressed={camOn}
						>
							{#if camOn}<Video size={18} />{:else}<VideoOff size={18} />{/if}
						</button>
						{#if camOn && device.coarse}
							<button
								onclick={() => av?.flipCam()}
								class="{ICON} text-muted-dim hover:text-muted"
								title="front or back camera"
								aria-label="flip camera"><SwitchCamera size={18} /></button
							>
						{/if}
						<!-- The danger token while sharing (#563): the state that can
						     put a private tab on the stage. -->
						<button
							onclick={() => void av?.toggleShare()}
							class="{ICON} max-sm:hidden {sharing
								? 'bg-danger/15 text-danger'
								: 'text-muted-dim hover:text-muted'}"
							title={sharing ? 'stop sharing your screen' : 'share your screen'}
							aria-label="share screen"
							aria-pressed={sharing}
						>
							{#if sharing}<ScreenShareOff size={18} />{:else}<ScreenShare
									size={18}
								/>{/if}
						</button>
						<QuickAudio compact />
						<!-- A hang-up: you stay in the channel, and riding (#2560). -->
						<button
							onclick={() => av?.leave()}
							class="{ICON} text-muted-dim hover:text-danger"
							title="leave voice — stay in the channel"
							aria-label="leave voice"><PhoneOff size={18} /></button
						>
					{/if}
				</div>
			{/if}

			<div class="ml-auto flex items-center gap-1">
				{#if track}
					<button
						onclick={openSheet}
						class="hover:bg-ink/5 text-muted flex h-11 max-w-56 min-w-0 items-center gap-2 rounded px-2 text-sm max-lg:hidden"
						title="The jukebox"
						><Music size={16} class="shrink-0" /><span class="truncate"
							>{track}</span
						></button
					>
				{/if}
				<button
					onclick={openSheet}
					class="text-muted hover:text-ink hover:bg-ink/5 flex h-11 shrink-0 items-center gap-1 rounded px-2"
					title="Who is here, the jukebox and cheers"
					aria-label="who is here"
					><Users size={18} /><span class="text-xs tabular-nums">{people}</span
					></button
				>
				<!-- A split button (#706): the face is always Away, the arrow the
				     named states. -->
				<div class="flex">
					<button
						onclick={() => setAway(!away, '')}
						aria-pressed={away}
						{@attach contextMenu(awayItems)}
						class="btn min-h-11 {away ? 'btn-primary' : 'btn-secondary'} {away
							? ''
							: 'rounded-r-none'}"
						><awayFace.icon size={14} />
						<span class="max-md:sr-only">{away ? "I'm back" : 'Away'}</span
						></button
					>
					{#if !away}
						<button
							onclick={(event) => {
								const box = event.currentTarget.getBoundingClientRect();
								openMenu(awayItems(), box.right, box.top, event.currentTarget);
							}}
							aria-label="Choose a state"
							aria-haspopup="menu"
							class="btn btn-secondary min-h-11 rounded-l-none px-2"
							><ChevronDown size={14} /></button
						>
					{/if}
				</div>
				<!-- The way out of the channel (#2447). Quiet: leaving is re-doable. -->
				<button
					onclick={leaveChannel}
					class="btn btn-secondary min-h-11 px-2"
					title="leave {conn.address.name}"
					><LogOut size={14} />
					<span class="max-md:sr-only">Leave</span></button
				>
			</div>
		</div>
	</div>
{/if}
