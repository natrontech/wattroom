<script lang="ts">
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import Select from '$lib/components/Select.svelte';
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';
	import { formatWhen } from '$lib/format';
	import { play } from '$lib/sound/cues';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { notify } from '$lib/notify.svelte';
	import { theme } from '$lib/theme.svelte';
	import {
		Bell,
		BellOff,
		LogOut,
		Mic,
		MicOff,
		Monitor,
		Moon,
		SlidersHorizontal,
		Sun,
		Video,
		VideoOff,
	} from '@lucide/svelte';
	import type { RailRoom } from '$lib/room/mockcompat';

	let {
		you,
		live,
		rooms = [],
		activeSlug = '',
		micOn = $bindable(true),
		camOn = $bindable(true),
		onMic,
		onCam,
		micLevel = 0,
		transmitting = false,
		voiceMode = 'gate',
		gateThreshold = 0.02,
		pttHeld = false,
		onVoiceMode,
		onGateThreshold,
		onPtt,
		activeSpeaking = [],
		mixRiders = [],
		onRiderGain,
		micTesting = false,
		onMicTest,
		connectedSlug = '',
		onLeave,
		onMember,
		showAv = true,
		voiceStatus = 'off',
		devices = { mics: [], cams: [], outs: [] },
		micId = '',
		camId = '',
		outId = '',
		canPickOutput = false,
		onDevice,
		onDevicesOpen,
	}: {
		you: { name: string; ftp: number };
		live: boolean;
		rooms?: RailRoom[];
		activeSlug?: string;
		micOn?: boolean;
		camOn?: boolean;
		onMic?: () => void;
		onCam?: () => void;
		/** Own transmit level 0..1 — the is-my-mic-dead meter (#151). */
		micLevel?: number;
		/** The gate's verdict: is audio leaving this machine right now? */
		transmitting?: boolean;
		voiceMode?: 'gate' | 'ptt';
		gateThreshold?: number;
		pttHeld?: boolean;
		onVoiceMode?: (mode: 'gate' | 'ptt') => void;
		onGateThreshold?: (threshold: number) => void;
		onPtt?: (held: boolean) => void;
		/** Names speaking right now in the ACTIVE room (the only one you can
		 * hear) — the rail highlights them Discord-style (#174). */
		activeSpeaking?: string[];
		/** Riders currently audible, for the per-rider faders (#179). */
		mixRiders?: { id: string; name: string }[];
		onRiderGain?: (id: string, gain: number) => void;
		micTesting?: boolean;
		onMicTest?: () => void;
		/** The room you are IN (#173) — shown and leavable from anywhere. */
		connectedSlug?: string;
		onLeave?: () => void;
		/** Click a member (#207): who is this rider. */
		onMember?: (slug: string, name: string) => void;
		/** The AV controls only make sense inside a room. */
		showAv?: boolean;
		/** Whether YOU are in the voice channel — the answer #181's feedback
		 * says the UI never gave. */
		voiceStatus?: 'off' | 'connecting' | 'live' | 'reconnecting' | 'failed';
		/** What's plugged in, for the pickers ('' id = system default). */
		devices?: {
			mics: { deviceId: string; label: string }[];
			cams: { deviceId: string; label: string }[];
			outs: { deviceId: string; label: string }[];
		};
		micId?: string;
		camId?: string;
		outId?: string;
		/** Speaker switching needs AudioContext.setSinkId — Chrome-only. */
		canPickOutput?: boolean;
		onDevice?: (kind: 'mic' | 'cam' | 'out', id: string) => void;
		/** Labels only exist post-permission — re-enumerate when the panel opens. */
		onDevicesOpen?: () => void;
	} = $props();

	const inVoice = $derived(voiceStatus === 'live');
	const deviceOptions = (
		list: { deviceId: string; label: string }[],
		kind: string,
	) => [
		{ value: '', label: 'System default' },
		...list
			.filter((d) => d.deviceId && d.deviceId !== 'default')
			.map((d, i) => ({
				value: d.deviceId,
				label: d.label || `${kind} ${i + 1}`,
			})),
	];

	// Glossary vocabulary only — no per-screen synonyms.
	const pages = [
		{ href: '/home', label: 'Home' },
		{ href: '/rooms', label: 'Rooms' },
		{ href: '/workouts', label: 'Workouts' },
		{ href: '/ramp', label: 'Ramp test' },
		{ href: '/pair', label: 'Sensors' },
		{ href: '/history', label: 'Rides' },
		{ href: '/profile', label: 'Profile' },
	];
	const activePath = $derived(page.url.pathname);

	let voiceAdvanced = $state(false);
</script>

<nav
	class="bg-surface border-ink/5 flex h-full w-56 shrink-0 flex-col border-r"
>
	<div class="flex items-center gap-2 px-4 py-4">
		<Logo size={24} {live} />
		<span class="font-display text-sm font-bold">WattRoom</span>
	</div>

	<div class="eyebrow px-4 pt-2 pb-1">your rooms</div>
	<ul class="flex-1 px-2">
		{#each rooms as room (room.slug)}
			<li>
				<a
					href={room.voice?.length
						? `/r/${room.slug}?voice=1`
						: `/r/${room.slug}`}
					class="flex w-full flex-wrap items-center gap-x-2 rounded px-2 py-1.5 text-left text-sm {room.slug ===
					activeSlug
						? 'bg-surface-raised text-ink'
						: 'text-muted hover:text-ink'}"
				>
					{#if room.slug === connectedSlug}
						<span
							class="bg-z4 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
							title="you are in this room"
						></span>
					{/if}
					<span class="truncate"
						>{room.icon ? `${room.icon} ` : ''}{room.name}</span
					>
					{#if room.slug === connectedSlug && onLeave}
						<button
							onclick={(e) => {
								e.preventDefault();
								onLeave();
							}}
							class="text-muted hover:text-ink ml-auto shrink-0"
							title="leave the room"
							aria-label="leave the room"><LogOut size={12} /></button
						>
					{/if}
					{#if room.live}
						<span
							class="bg-watt glow-stroke h-1.5 w-1.5 shrink-0 rounded-full {room.slug ===
							connectedSlug
								? ''
								: 'ml-auto'}"
							title="riding now"
						></span>
					{:else if (room.connected ?? 0) > 0}
						<span
							class="flex shrink-0 items-center gap-1 {room.slug ===
							connectedSlug
								? ''
								: 'ml-auto'}"
							title={(room.riders ?? []).join(', ')}
						>
							<span class="bg-z4 h-1.5 w-1.5 rounded-full"></span>
							<span class="text-muted/70 font-mono text-[10px]"
								>{room.connected}</span
							>
						</span>
					{:else if room.members > 0}
						<span class="text-muted/70 ml-auto shrink-0 font-mono text-[10px]"
							>{room.members}</span
						>
					{/if}
					{#if room.next && !room.riders?.length}
						<span class="text-muted/70 w-full truncate text-[10px]"
							>next: {room.next.workoutName} · {formatWhen(
								room.next.startsAt,
							)}</span
						>
					{/if}
				</a>
				{#if room.riders?.length}
					<!-- The member tree (#174): who is here, in voice, talking —
					     the mental model the crew already has. -->
					<ul class="mt-0.5 mb-1 ml-4 space-y-0.5">
						{#each room.riders.slice(0, 8) as name (name)}
							{@const inVoice = room.voice?.includes(name)}
							{@const talking =
								room.slug === activeSlug && activeSpeaking.includes(name)}
							<!-- Listed = connected, so the dot is green full stop;
							     voice brightens the name, talking pulses it (#174). -->
							<li
								class="flex items-center gap-1.5 text-[11px] {talking
									? 'text-ink'
									: inVoice
										? 'text-ink/85'
										: 'text-ink/60'}"
							>
								<span
									class="bg-z4 h-1.5 w-1.5 rounded-full {talking
										? 'animate-pulse'
										: ''}"
								></span>
								<button
									onclick={() => onMember?.(room.slug, name)}
									class="hover:text-ink truncate hover:underline">{name}</button
								>
								{#if talking}
									<span class="text-z4 text-[9px]">speaking</span>
								{/if}
							</li>
						{/each}
						{#if room.riders.length > 8}
							<li class="text-muted/60 text-[10px]">
								+{room.riders.length - 8} more
							</li>
						{/if}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>

	<div class="eyebrow px-4 pt-3 pb-1">everywhere</div>
	<ul class="px-2 pb-2">
		{#each pages as entry (entry.href)}
			<li>
				<a
					href={entry.href}
					class="block rounded px-2 py-1.5 text-sm {activePath === entry.href
						? 'bg-surface-raised text-ink'
						: 'text-muted hover:text-ink'}">{entry.label}</a
				>
			</li>
		{/each}
	</ul>

	<!-- Your own presence, pinned to the bottom the way a voice app does it.
	     ONE row whatever the connection state — the nav above never jumps
	     (rider report: the height flicker read as broken). -->
	<div class="border-ink/5 border-t px-3 py-3">
		<div class="flex h-7 items-center gap-2">
			<span class="bg-z4 h-2 w-2 shrink-0 rounded-full"></span>
			<span class="truncate text-xs font-medium">{you.name}</span>
			<span class="text-muted ml-auto font-mono text-[10px]">{you.ftp} FTP</span
			>
			{#if showAv}
				<!-- Joined-and-live is green, joined-but-muted is red, not joined is
				     dim — the three states #181's feedback couldn't tell apart. -->
				<button
					onclick={() => (onMic ? onMic() : (micOn = !micOn))}
					class="rounded p-1 {inVoice
						? micOn
							? 'text-z4'
							: 'text-z6'
						: 'text-muted/50 hover:text-muted'}"
					title={inVoice ? (micOn ? 'mute' : 'unmute') : 'join voice'}
					aria-label={inVoice
						? micOn
							? 'mute microphone'
							: 'unmute microphone'
						: 'join voice'}
				>
					{#if inVoice && micOn}<Mic size={14} />{:else}<MicOff
							size={14}
						/>{/if}
				</button>
				<button
					onclick={() => (onCam ? onCam() : (camOn = !camOn))}
					class="rounded p-1 {inVoice && camOn
						? 'text-z4'
						: 'text-muted/50 hover:text-muted'}"
					title={inVoice && camOn ? 'turn camera off' : 'turn camera on'}
					aria-label={inVoice && camOn ? 'turn camera off' : 'turn camera on'}
				>
					{#if inVoice && camOn}<Video size={14} />{:else}<VideoOff
							size={14}
						/>{/if}
				</button>
				<button
					onclick={() => {
						voiceAdvanced = !voiceAdvanced;
						if (voiceAdvanced) onDevicesOpen?.();
					}}
					class="rounded p-1 {voiceAdvanced ? 'text-ink' : 'text-muted'}"
					title="voice & device settings"
					aria-label="voice and device settings"
				>
					<SlidersHorizontal size={14} />
				</button>
			{/if}
		</div>
		{#if showAv}
			<!-- One always-present line answering "am I in voice, is my camera on":
			     constant height, so the nav above never jumps. -->
			<p class="text-muted mt-1.5 truncate text-[10px]">
				{#if voiceStatus === 'live'}
					<span class="text-z4">in voice</span>{camOn ? ' · camera on' : ''} ·
					{voiceMode === 'ptt' ? 'push to talk' : 'voice activation'}
				{:else if voiceStatus === 'connecting'}
					joining voice…
				{:else if voiceStatus === 'reconnecting'}
					<span class="text-z5">voice reconnecting…</span>
				{:else if voiceStatus === 'failed'}
					<span class="text-z6">voice failed</span> — tap the mic to retry
				{:else}
					not in voice — tap the mic to join
				{/if}
			</p>
		{/if}
		{#if showAv && voiceMode === 'ptt' && micOn}
			<!-- Hold to transmit — the desk spectator's mode (SPEC). -->
			<button
				onpointerdown={() => onPtt?.(true)}
				onpointerup={() => onPtt?.(false)}
				onpointerleave={() => pttHeld && onPtt?.(false)}
				class="mt-2 w-full rounded border px-2 py-2 text-[11px] {pttHeld
					? 'border-neon/50 text-ink'
					: 'border-muted/25 text-muted hover:text-ink'}"
				>{pttHeld
					? 'transmitting · release to stop'
					: 'hold to talk (or space)'}</button
			>
		{/if}
		{#if showAv && (micOn || micTesting)}
			<ProgressBar
				pct={Math.round(micLevel * 140)}
				h="h-1"
				fill="{transmitting
					? 'bg-z4'
					: 'bg-muted/40'} transition-[width] duration-100"
				class="mt-2"
				title={transmitting ? 'transmitting' : 'gated — below the threshold'}
			/>
		{/if}
		<button
			onclick={() => theme.cycle()}
			class="text-muted hover:text-ink mt-2 mr-3 inline-flex items-center gap-1 text-[10px] underline"
			title="auto follows your OS; the room is always dark"
		>
			{#if theme.current === 'auto'}<Monitor
					size={11}
				/>{:else if theme.current === 'dark'}<Moon size={11} />{:else}<Sun
					size={11}
				/>{/if}
			theme · {theme.current}</button
		>
		{#if notify.supported}
			<button
				onclick={() =>
					notify.enabled ? notify.disable() : void notify.enable()}
				class="text-muted hover:text-ink mt-2 mr-3 inline-flex items-center gap-1 text-[10px] underline"
				title="chat, arrivals and session starts reach you while the tab is in the background"
			>
				{#if notify.enabled}<Bell size={11} />{:else}<BellOff size={11} />{/if}
				alerts · {notify.enabled ? 'on' : 'off'}</button
			>
		{/if}
		{#if showAv}
			{#if voiceAdvanced}
				<div class="border-muted/15 mt-2 rounded border p-2">
					<!-- Which mic/cam/speakers this machine is actually using (#181
					     feedback) — one picker each, default until chosen. -->
					<span class="eyebrow">devices</span>
					<label class="mt-1.5 block text-[10px]">
						<span class="text-muted">microphone</span>
						<div class="mt-0.5">
							<Select
								label="Microphone"
								value={micId}
								options={deviceOptions(devices.mics, 'Microphone')}
								onchange={(id) => onDevice?.('mic', id)}
							/>
						</div>
					</label>
					<label class="mt-1.5 block text-[10px]">
						<span class="text-muted">camera</span>
						<div class="mt-0.5">
							<Select
								label="Camera"
								value={camId}
								options={deviceOptions(devices.cams, 'Camera')}
								onchange={(id) => onDevice?.('cam', id)}
							/>
						</div>
					</label>
					{#if canPickOutput}
						<label class="mt-1.5 block text-[10px]">
							<span class="text-muted">speakers · voice only</span>
							<div class="mt-0.5">
								<Select
									label="Speakers"
									value={outId}
									options={deviceOptions(devices.outs, 'Speakers')}
									onchange={(id) => onDevice?.('out', id)}
								/>
							</div>
						</label>
					{/if}
					{#if devices.mics.length > 0 && !devices.mics.some((d) => d.label)}
						<p class="text-muted/70 mt-1 text-[10px]">
							Names appear after the first voice join grants mic access.
						</p>
					{/if}

					<div class="border-ink/5 mt-3 border-t pt-2"></div>
					<label class="flex items-center gap-2 text-[11px]">
						<input
							type="radio"
							checked={voiceMode === 'gate'}
							onchange={() => onVoiceMode?.('gate')}
						/>
						Voice activation
					</label>
					<label class="mt-1 flex items-start gap-2 text-[11px]">
						<input
							type="radio"
							checked={voiceMode === 'ptt'}
							onchange={() => onVoiceMode?.('ptt')}
						/>
						<span
							>Push to talk
							<span class="text-muted block text-[10px]"
								>for spectating from a desk</span
							></span
						>
					</label>
					{#if onMicTest && !micOn}
						<button
							onclick={onMicTest}
							class="mt-2 w-full rounded border px-2 py-1.5 text-[11px] {micTesting
								? 'border-z4/60 text-ink'
								: 'border-muted/25 text-muted hover:text-ink'}"
							>{micTesting
								? 'testing — you hear yourself · stop'
								: 'test my mic'}</button
						>
						{#if micTesting}
							<p class="text-muted mt-1 text-[10px]">
								{transmitting
									? 'gate open — this would transmit'
									: 'gate closed — speak up or lower the threshold'}
							</p>
						{/if}
					{/if}
					{#if voiceMode === 'gate'}
						<label class="mt-2 block text-[10px]">
							<span class="text-muted">gate threshold</span>
							<input
								type="range"
								min="0.005"
								max="0.08"
								step="0.005"
								value={gateThreshold}
								oninput={(e) =>
									onGateThreshold?.(Number(e.currentTarget.value))}
								class="mt-1 w-full"
							/>
						</label>
					{/if}

					<!-- The mixer (#179): every level in one place. Ducking dips
					     under the music ceiling; it never fights these faders. -->
					<div class="border-ink/5 mt-3 border-t pt-2">
						<span class="eyebrow">mixer</span>
						<label class="mt-1.5 block text-[10px]">
							<span class="text-muted">music</span>
							<input
								type="range"
								min="0"
								max="100"
								step="5"
								value={mixer.music}
								oninput={(e) => mixer.setMusic(Number(e.currentTarget.value))}
								class="mt-0.5 w-full"
							/>
						</label>
						<label class="mt-1.5 block text-[10px]">
							<span class="text-muted">cues</span>
							<input
								type="range"
								min="0"
								max="1"
								step="0.05"
								value={mixer.cues}
								oninput={(e) => mixer.setCues(Number(e.currentTarget.value))}
								onchange={() => play('block')}
								class="mt-0.5 w-full"
							/>
						</label>
						{#each mixRiders as rider (rider.id)}
							<label class="mt-1.5 block text-[10px]">
								<span class="text-muted">{rider.name}</span>
								<input
									type="range"
									min="0"
									max="2"
									step="0.1"
									value={mixer.riderGain(rider.id)}
									oninput={(e) =>
										onRiderGain?.(rider.id, Number(e.currentTarget.value))}
									class="mt-0.5 w-full"
								/>
							</label>
						{/each}
					</div>
				</div>
			{/if}
		{/if}
	</div>
</nav>
