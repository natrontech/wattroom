<script lang="ts">
	// Your voice in the call: Join voice, or mic, camera, screen, sound and the
	// hang-up. `docked` is the sidebar's foot on a desk, a row of its own under
	// your name. Riding or on a phone the sidebar is out of reach, so the now
	// bar carries these instead.
	import QuickAudio from '#lib/channel/QuickAudio.svelte';
	import { account, voiceUp } from '#lib/account.svelte.ts';
	import { contextMenu, MENU_HINT } from '#lib/context-menu.svelte.ts';
	import { micMenu } from '#lib/channel/mic-menu.ts';
	import { channelConnection } from '#lib/channel/connection.svelte.ts';
	import { rideBar } from '#lib/nav/ride-bar.svelte.ts';
	import { device } from '#lib/device.svelte.ts';
	import Headphones from '@lucide/svelte/icons/headphones';
	import Mic from '@lucide/svelte/icons/mic';
	import MicOff from '@lucide/svelte/icons/mic-off';
	import PhoneOff from '@lucide/svelte/icons/phone-off';
	import ScreenShare from '@lucide/svelte/icons/screen-share';
	import ScreenShareOff from '@lucide/svelte/icons/screen-share-off';
	import SwitchCamera from '@lucide/svelte/icons/switch-camera';
	import Video from '@lucide/svelte/icons/video';
	import VideoOff from '@lucide/svelte/icons/video-off';

	let {
		riding = false,
		docked = false,
	}: { riding?: boolean; docked?: boolean } = $props();

	const conn = $derived(channelConnection.call);
	const av = $derived(conn?.av);
	// The call server has to be up (#2850): down, Join voice is drawn disabled
	// with the reason.
	const voiceDown = $derived(!voiceUp(account.me));
	const voiceStatus = $derived(av?.status ?? 'off');
	const inVoice = $derived(voiceStatus === 'live');
	const joining = $derived(
		voiceStatus === 'connecting' || voiceStatus === 'reconnecting',
	);
	const micOn = $derived(av?.micOn ?? false);
	// A muted mic holds no capture (#4161), so unmuting opens the device again.
	const micStarting = $derived(av?.micStarting ?? false);
	const camOn = $derived(av?.camOn ?? false);
	const sharing = $derived(av?.sharing ?? false);
	// Another of your screens carries your voice (ADR-0089): this one moves it.
	const voiceElsewhere = $derived(conn?.live.pairing.elsewhere?.voice ?? '');

	// 44 px either way: muting is the most-pressed control mid-ride. The foot
	// shares its 240 px out evenly, the bar gives each a square.
	const ICON = $derived(
		`grid h-11 place-items-center rounded hover:bg-ink/5 ${docked ? 'min-w-0 flex-1' : 'w-11 shrink-0'}`,
	);
</script>

<div class="flex items-center {docked ? 'flex-wrap gap-1' : ''}">
	{#if !inVoice}
		{#if !joining}
			<button
				onclick={() => void av?.join(voiceElsewhere ? { take: true } : {})}
				disabled={voiceDown}
				title={voiceDown
					? 'Voice is down on this server right now. It comes back on its own.'
					: device.coarse
						? 'Never recorded. Tap the mic to talk.'
						: 'Never recorded. Your mic opens when you speak.'}
				class="btn {riding ? 'btn-secondary' : 'btn-primary'} min-h-11 {docked
					? 'flex-1'
					: 'whitespace-nowrap'} {docked && voiceElsewhere ? 'basis-full' : ''}"
				><Headphones size={14} />
				<span class={docked ? '' : rideBar.on ? 'sr-only' : 'max-sm:sr-only'}
					>{voiceElsewhere
						? 'Use this device for voice'
						: voiceStatus === 'failed'
							? 'Try voice again'
							: 'Join voice'}</span
				></button
			>
		{:else if docked}
			<span class="text-muted flex-1 px-1 text-xs"
				>{voiceStatus === 'connecting'
					? 'joining voice…'
					: 'reconnecting…'}</span
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
			{#if micStarting}<span class="text-[10px] leading-none">starting</span
				>{:else if micOn}<Mic size={18} />{:else}<MicOff size={18} />{/if}
		</button>
		<button
			onclick={() => av?.toggleCam()}
			class="{ICON} {camOn ? 'text-ok' : 'text-muted-dim hover:text-muted'}"
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
		<!-- The danger token while sharing (#563): the state that can put a
		     private tab on the stage. -->
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
