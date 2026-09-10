<script lang="ts">
	// Your own calendar link (ADR-0021): every session in every room you are
	// in, one subscription for good — joining or leaving a room changes the
	// feed, not the link. The ADR made this the feed the UI offers first, and
	// then nothing offered it: the Sessions place had the room's, so a rider
	// in four rooms subscribed four times (#1374). Home's What's next is the
	// list it mirrors, so the link lives under it.
	import { api } from '$lib/api';
	import { toasts } from '$lib/toast.svelte';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Copy from '@lucide/svelte/icons/copy';
	import { onMount } from 'svelte';

	let token = $state<string | null>(null);
	let error = $state<string | null>(null);

	async function load() {
		const res = await api<{ icsToken: string }>('/api/schedule');
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		token = res.data.icsToken;
	}
	onMount(() => void load());

	const link = $derived(
		token ? `${location.origin}/api/calendar/${token}.ics` : '',
	);

	function copy() {
		void navigator.clipboard.writeText(link).then(
			() =>
				toasts.push(
					'Calendar link copied — subscribe "from URL" in your calendar app.',
				),
			() =>
				toasts.push(`Could not copy — the link is ${link}`, {
					tone: 'error',
					seconds: 12,
				}),
		);
	}

	// Rotating is instant and breaks every subscription on the old link —
	// the escape hatch for a leak, which 95% of riders never need (ux.md).
	async function rotate() {
		const res = await api<{ icsToken: string }>('/api/calendar/rotate', {
			method: 'POST',
		});
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		token = res.data.icsToken;
		toasts.push(
			'Calendar link reset — calendars on the old link stop updating.',
		);
	}
</script>

<div class="panel flex flex-wrap items-center gap-3 px-4 py-3">
	<CalendarClock size={16} class="text-muted shrink-0" />
	<p class="text-muted min-w-0 flex-1 text-xs">
		{#if error}
			{error}
			<button onclick={() => void load()} class="btn-link ml-1">Retry</button>
		{:else}
			Every session in every room you are in lands in your calendar app —
			subscribe once, "from URL". Join or leave a room and the calendar follows.
		{/if}
	</p>
	<button
		onclick={copy}
		disabled={!token}
		class="btn btn-secondary btn-xs shrink-0"
		><Copy size={13} /> Copy calendar link</button
	>
</div>
<!-- The warning on the page, not buried (ADR-0021): this link says more than
     a room's did. The reset is folded, because needing it is rare. -->
<p class="text-muted-dim mt-1.5 text-[11px]">
	The link carries a private key: anyone holding it sees what you plan to ride
	and which rooms you are in.
</p>
<details class="mt-1">
	<summary class="text-muted hover:text-ink cursor-pointer text-[11px]"
		>Advanced</summary
	>
	<p class="text-muted mt-2 max-w-md text-xs">
		If the link ever leaks, reset it: every calendar that has the old one stops
		updating until it subscribes again.
	</p>
	<button
		onclick={() => void rotate()}
		disabled={!token}
		class="btn btn-secondary btn-xs mt-2">Reset calendar link</button
	>
</details>
