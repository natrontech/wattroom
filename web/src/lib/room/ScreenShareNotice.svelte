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
	import { ScreenShareOff, MonitorUp } from '@lucide/svelte';
	import { goto } from '$app/navigation';

	let {
		sharing,
		room,
		pathname,
		onStop,
	}: {
		sharing: boolean;
		room: { slug: string; name?: string } | null;
		pathname: string;
		onStop: () => void;
	} = $props();

	const notice = $derived(shareNotice(sharing, room, pathname));
</script>

{#if notice}
	<div
		title={MENU_HINT}
		{@attach contextMenu(() => [
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
		<span class="bg-danger h-2.5 w-2.5 shrink-0 animate-pulse rounded-full"
		></span>
		<MonitorUp size={16} class="text-danger shrink-0" />
		<p class="min-w-0 flex-1 truncate text-sm">
			<span class="font-medium">You're sharing your screen</span>
			<span class="text-muted">
				{#if notice.href}
					with <a href={notice.href} class="underline">{notice.room}</a>
				{:else}
					with everyone in {notice.room}
				{/if}
			</span>
		</p>
		<button onclick={onStop} class="btn btn-danger-solid btn-lg shrink-0">
			<ScreenShareOff size={16} />
			Stop sharing
		</button>
	</div>
{/if}
