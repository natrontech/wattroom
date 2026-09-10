<script lang="ts">
	// Your own calendar link (ADR-0021): every session in every room you are
	// in, one subscription for good — joining or leaving a room changes the
	// feed, not the link. The ADR made this the feed the UI offers first, and
	// then nothing offered it: the Sessions place had the room's, so a rider
	// in four rooms subscribed four times (#1374).
	//
	// It sat on Home under "What's next" — the only account-level secret not
	// under Your data, because the decision predates the settings tree (#1860).
	// A bearer URL that says what you plan to ride and which rooms you are in
	// belongs with the export and the API tokens; Home keeps the pointer, where
	// a rider is already looking at the list this mirrors.
	import { api } from '$lib/api';
	import {
		confirmCalendarReset,
		copyCalendarLink,
		RESET_DONE,
	} from '$lib/calendar-link';
	import { toasts } from '$lib/toast.svelte';
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

	// The escape hatch for a leaked link, which 95% of riders never need
	// (ux.md) — and it asks first: nothing puts the old link back, and it is
	// other people's calendars that go quiet (errors.md, #1493).
	async function rotate() {
		if (!(await confirmCalendarReset('yours'))) return;
		const res = await api<{ icsToken: string }>('/api/calendar/rotate', {
			method: 'POST',
		});
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		token = res.data.icsToken;
		toasts.push(RESET_DONE);
	}
</script>

<section class="panel mt-8 p-6">
	<h2 class="font-display font-bold">Calendar link</h2>
	<p class="text-muted mt-1 text-xs">
		{#if error}
			{error}
			<button onclick={() => void load()} class="btn-link ml-1">Retry</button>
		{:else}
			Every session in every room you are in lands in your calendar app —
			subscribe once, "from URL". Join or leave a room and the calendar follows.
		{/if}
	</p>
	<div class="mt-4 flex flex-wrap items-center gap-3">
		<button
			onclick={() => void copyCalendarLink(link)}
			disabled={!token}
			class="btn btn-secondary"><Copy size={14} /> Copy calendar link</button
		>
	</div>
	<!-- The warning on the page, not buried (ADR-0021): this link says more than
	     a room's did. The reset is folded, because needing it is rare. -->
	<p class="text-muted-dim mt-3 text-[11px]">
		The link carries a private key: anyone holding it sees what you plan to ride
		and which rooms you are in.
	</p>
	<details class="mt-1">
		<summary class="text-muted hover:text-ink cursor-pointer text-[11px]"
			>Advanced</summary
		>
		<p class="text-muted mt-2 max-w-md text-xs">
			If the link ever leaks, reset it: every calendar that has the old one
			stops updating until it subscribes again.
		</p>
		<button
			onclick={() => void rotate()}
			disabled={!token}
			class="btn btn-secondary btn-xs mt-2">Reset calendar link</button
		>
	</details>
</section>
