<script lang="ts">
	// You, one line on the crew's Home (#2586): WattRoom opens in your crew
	// (#2576), so your week has to reach you here, not only on your own Home.
	// Decorative context, like Home's form line: a read that fails leaves the
	// line away rather than saying "0 rides" it does not know.
	import { account, unchosen } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { formatDuration } from '$lib/format';
	import type { ServerRide } from '$lib/ride/list';
	import { weekTotals } from '$lib/ride/week';
	import ChartColumn from '@lucide/svelte/icons/chart-column';

	let week = $state<ReturnType<typeof weekTotals> | null>(null);
	$effect(() => {
		void api<{ rides: ServerRide[] }>('/api/rides').then((res) => {
			if (res.ok) week = weekTotals(res.data.rides);
		});
	});
	// A guessed FTP is not said as if it were measured (#1484).
	const ftp = $derived(
		account.me && !unchosen(account.me.ftpSource) ? account.me.ftpWatts : null,
	);
</script>

{#if week}
	<a
		href="/home"
		class="text-muted hover:text-ink mt-3 inline-flex items-center gap-2 text-xs tabular-nums"
		title="Your Home"
	>
		<ChartColumn size={13} class="shrink-0" />
		<span>
			You this week:
			{#if week.count}
				{week.count} ride{week.count === 1 ? '' : 's'} · {formatDuration(
					week.minutes * 60,
				)}
			{:else}
				no rides yet
			{/if}
			{#if ftp}· FTP {ftp} W{/if}
		</span>
	</a>
{/if}
