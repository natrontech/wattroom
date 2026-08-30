<script lang="ts">
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';
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

	// SPEC room audio: while the jukebox plays, VAD tightens and push-to-talk is offered.
	let pushToTalk = $state(false);
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
					href="/r/{room.slug}"
					class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm {room.slug ===
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
				</a>
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
		{#if live && showAv}
			<button
				onclick={() => (pushToTalk = !pushToTalk)}
				class="mt-2 w-full rounded border px-2 py-1.5 text-[11px] {pushToTalk
					? 'border-neon/50 text-white'
					: 'border-muted/25 text-muted hover:text-white'}"
				>{pushToTalk ? 'push to talk · hold space' : 'push to talk'}</button
			>
		{/if}
		{#if showAv && micOn && micLevel >= 0}
			<div
				class="bg-surface-raised mt-2 h-1 overflow-hidden rounded-full"
				title="your mic level"
			>
				<div
					class="bg-z4 h-full transition-[width] duration-100"
					style="width: {Math.min(100, Math.round(micLevel * 140))}%"
				></div>
			</div>
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
