<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import type { MockRider, RailRoom } from '$lib/room/mockcompat';

	let {
		you,
		live,
		rooms = [],
		activeSlug = '',
		micOn = $bindable(true),
		camOn = $bindable(true),
		onMic,
		onCam,
	}: {
		you: MockRider;
		live: boolean;
		rooms?: RailRoom[];
		activeSlug?: string;
		micOn?: boolean;
		camOn?: boolean;
		onMic?: () => void;
		onCam?: () => void;
	} = $props();

	// SPEC room audio: while the jukebox plays, VAD tightens and push-to-talk is offered.
	let pushToTalk = $state(false);
</script>

<nav class="bg-surface flex w-56 shrink-0 flex-col border-r border-white/5">
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
						></span>
					{:else if room.members > 0}
						<span class="text-muted/70 ml-auto shrink-0 font-mono text-[10px]"
							>{room.members}</span
						>
					{/if}
				</a>
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
		{#if live}
			<button
				onclick={() => (pushToTalk = !pushToTalk)}
				class="mt-2 w-full rounded border px-2 py-1.5 text-[11px] {pushToTalk
					? 'border-neon/50 text-white'
					: 'border-muted/25 text-muted hover:text-white'}"
				>{pushToTalk ? 'push to talk · hold space' : 'push to talk'}</button
			>
		{/if}
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
	</div>
</nav>
