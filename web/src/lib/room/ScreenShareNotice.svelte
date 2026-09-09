<script lang="ts">
	// #563: while your screen is live, nothing in the room said so loudly
	// enough — the control kept its neutral styling and the browser's own
	// share bar is usually on a display the rider cannot see. This is
	// persistent status, not a toast (errors.md): it sits above the page the
	// rider is on, on every page, until the share ends. It is deliberately
	// NOT an overlay — a floating pill would sooner or later land on the
	// jukebox player, and RMF forbids drawing over it.
	import { contextMenu, MENU_HINT } from '$lib/context-menu.svelte';
	import { shareNotice } from '$lib/room/share-notice';
	import ScreenShareOff from '@lucide/svelte/icons/screen-share-off';
	import MonitorUp from '@lucide/svelte/icons/monitor-up';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeOff from '@lucide/svelte/icons/volume-off';
	import { goto } from '$app/navigation';

	let {
		sharing,
		sharingAudio = false,
		room,
		pathname,
		onStop,
		onSound,
	}: {
		sharing: boolean;
		/** Whether the room can HEAR the machine too (#1124). */
		sharingAudio?: boolean;
		room: { slug: string; name?: string } | null;
		pathname: string;
		onStop: () => void;
		/**
		 * Turn the machine's sound off, or back on (#1751). Here rather than
		 * only in the picker because the one picker that never asks is macOS's
		 * own, and the shell does not get to answer for it.
		 */
		onSound?: (on: boolean) => void;
	} = $props();

	// Off is instant; on re-runs the share, so it says so (…) rather than
	// looking like a mute button that opens a picker.
	const soundLabel = $derived(
		sharingAudio
			? "Stop sending this machine's sound"
			: "Send this machine's sound too…",
	);

	const notice = $derived(shareNotice(sharing, room, pathname));
</script>

{#if notice}
	<div
		title={MENU_HINT}
		{@attach contextMenu(() => [
			...(onSound
				? [
						{
							label: soundLabel,
							icon: sharingAudio ? VolumeOff : Volume2,
							onSelect: () => onSound(!sharingAudio),
						},
					]
				: []),
			{
				label: 'Stop sharing your screen',
				icon: ScreenShareOff,
				onSelect: onStop,
				danger: true,
			},
			...(notice.href
				? [
						{
							label: `Back to ${notice.room}`,
							icon: MonitorUp,
							onSelect: () => void goto(notice.href as string),
						},
					]
				: []),
		])}
		class="border-danger/50 bg-danger/10 flex shrink-0 items-center gap-3 border-b px-3 py-2"
		role="status"
		aria-live="polite"
	>
		<span
			class="bg-danger h-2.5 w-2.5 shrink-0 rounded-full motion-safe:animate-pulse"
		></span>
		<MonitorUp size={16} class="text-danger shrink-0" />
		<p class="min-w-0 flex-1 truncate text-sm">
			<span class="font-medium"
				>You're sharing your screen{#if sharingAudio}
					and its sound{/if}</span
			>
			<span class="text-muted">
				{#if notice.href}
					with <a href={notice.href} class="underline">{notice.room}</a>
				{:else}
					with everyone in {notice.room}
				{/if}
			</span>
		</p>
		{#if onSound}
			<!-- The sound is its own control, not a footnote on the picture: the
			     rider who reported this could see what they were sharing and had
			     no way to say the room should not HEAR it (#1751). Icon-only and
			     44 px, because the row also carries the room's name at 375 px
			     (ux.md). -->
			<button
				onclick={() => onSound(!sharingAudio)}
				aria-pressed={sharingAudio}
				class="grid h-11 w-11 shrink-0 place-items-center rounded {sharingAudio
					? 'text-danger'
					: 'text-muted hover:text-ink'}"
				title={soundLabel}
				aria-label={soundLabel}
			>
				{#if sharingAudio}<Volume2 size={16} />{:else}<VolumeOff
						size={16}
					/>{/if}
			</button>
		{/if}
		<button onclick={onStop} class="btn btn-danger-solid btn-lg shrink-0">
			<ScreenShareOff size={16} />
			Stop sharing
		</button>
	</div>
{/if}
