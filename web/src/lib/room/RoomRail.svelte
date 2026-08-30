<script lang="ts">
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';
	import { mixer } from '$lib/sound/mixer.svelte';
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
		showAv = true,
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
		/** The AV controls only make sense inside a room. */
		showAv?: boolean;
	} = $props();

	// Glossary vocabulary only — no per-screen synonyms.
	const pages = [
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
	class="bg-surface flex h-full w-56 shrink-0 flex-col border-r border-white/5"
>
	<div class="flex items-center gap-2 px-4 py-4">
		<Logo size={24} {live} />
		<span class="font-display text-sm font-bold">WattRoom</span>
	</div>

	<div class="text-muted px-4 pt-2 pb-1 text-[10px] tracking-[0.2em] uppercase">
		your rooms
	</div>
	<ul class="flex-1 px-2">
		{#each rooms as room (room.slug)}
			<li>
				<a
					href={room.voice?.length
						? `/r/${room.slug}?voice=1`
						: `/r/${room.slug}`}
					class="flex w-full flex-wrap items-center gap-x-2 rounded px-2 py-1.5 text-left text-sm {room.slug ===
					activeSlug
						? 'bg-surface-raised text-white'
						: 'text-muted hover:text-white'}"
				>
					<span class="truncate">{room.name}</span>
					{#if room.live}
						<span
							class="bg-watt glow-stroke ml-auto h-1.5 w-1.5 shrink-0 rounded-full"
							title="riding now"
						></span>
					{:else if (room.connected ?? 0) > 0}
						<span
							class="ml-auto flex shrink-0 items-center gap-1"
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
							>next: {room.next.workoutName} ·
							{new Date(room.next.startsAt).toLocaleString(undefined, {
								weekday: 'short',
								hour: '2-digit',
								minute: '2-digit',
							})}</span
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
							<li
								class="flex items-center gap-1.5 text-[11px] {talking
									? 'text-white'
									: inVoice
										? 'text-white/80'
										: 'text-muted'}"
							>
								<span
									class="h-1.5 w-1.5 rounded-full {talking
										? 'bg-z4 animate-pulse'
										: inVoice
											? 'bg-z4'
											: 'bg-muted/30'}"
								></span>
								<span class="truncate">{name}</span>
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

	<div class="text-muted px-4 pt-3 pb-1 text-[10px] tracking-[0.2em] uppercase">
		everywhere
	</div>
	<ul class="px-2 pb-2">
		{#each pages as entry (entry.href)}
			<li>
				<a
					href={entry.href}
					class="block rounded px-2 py-1.5 text-sm {activePath === entry.href
						? 'bg-surface-raised text-white'
						: 'text-muted hover:text-white'}">{entry.label}</a
				>
			</li>
		{/each}
	</ul>

	<!-- Your own presence, pinned to the bottom the way a voice app does it. -->
	<div class="border-t border-white/5 px-3 py-3">
		<div class="flex items-center gap-2">
			<span class="bg-z4 h-2 w-2 rounded-full"></span>
			<span class="truncate text-xs font-medium">{you.name}</span>
			<span class="text-muted ml-auto font-mono text-[10px]">{you.ftp} FTP</span
			>
		</div>
		{#if showAv && voiceMode === 'ptt' && micOn}
			<!-- Hold to transmit — the desk spectator's mode (SPEC). -->
			<button
				onpointerdown={() => onPtt?.(true)}
				onpointerup={() => onPtt?.(false)}
				onpointerleave={() => pttHeld && onPtt?.(false)}
				class="mt-2 w-full rounded border px-2 py-2 text-[11px] {pttHeld
					? 'border-neon/50 text-white'
					: 'border-muted/25 text-muted hover:text-white'}"
				>{pttHeld
					? 'transmitting · release to stop'
					: 'hold to talk (or space)'}</button
			>
		{/if}
		{#if showAv && micOn}
			<div
				class="bg-surface-raised mt-2 h-1 overflow-hidden rounded-full"
				title={transmitting ? 'transmitting' : 'gated — below the threshold'}
			>
				<div
					class="h-full transition-[width] duration-100 {transmitting
						? 'bg-z4'
						: 'bg-muted/40'}"
					style="width: {Math.min(100, Math.round(micLevel * 140))}%"
				></div>
			</div>
		{/if}
		{#if showAv}
			<button
				onclick={() => (voiceAdvanced = !voiceAdvanced)}
				class="text-muted mt-2 text-[10px] underline hover:text-white"
				>voice settings</button
			>
			{#if voiceAdvanced}
				<div class="border-muted/15 mt-2 rounded border p-2">
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
					<div class="mt-3 border-t border-white/5 pt-2">
						<span class="text-muted text-[10px] tracking-[0.2em] uppercase"
							>mixer</span
						>
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
		{#if showAv}
			<div class="mt-2 flex gap-1.5">
				<button
					onclick={() => (onMic ? onMic() : (micOn = !micOn))}
					class="flex-1 rounded border px-2 py-1.5 text-[11px] {micOn
						? 'border-muted/30 text-white'
						: 'border-z6/40 text-z6'}">{micOn ? 'mic on' : 'muted'}</button
				>
				<button
					onclick={() => (onCam ? onCam() : (camOn = !camOn))}
					class="flex-1 rounded border px-2 py-1.5 text-[11px] {camOn
						? 'border-muted/30 text-white'
						: 'border-muted/20 text-muted'}"
					>{camOn ? 'cam on' : 'cam off'}</button
				>
			</div>
		{/if}
	</div>
</nav>
