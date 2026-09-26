<script lang="ts">
	import { OURS, type Rival } from './rivals';
	import { CHECKED, monthYear } from './seo';

	// WattRoom beside one rival or several, row by row (#2995). Wide on a
	// phone, so it scrolls inside itself and the page does not (ux.md).
	let { rivals }: { rivals: readonly Rival[] } = $props();

	const rows: { key: keyof typeof OURS & keyof Rival; label: string }[] = [
		{ key: 'price', label: 'Price' },
		{ key: 'runsOn', label: 'Runs on' },
		{ key: 'together', label: 'One workout, together' },
		{ key: 'voice', label: 'Talking while you ride' },
		{ key: 'world', label: 'Virtual world' },
		{ key: 'openSource', label: 'Open source' },
	];
</script>

<div class="panel panel-flush overflow-x-auto">
	<table class="w-full min-w-[40rem] border-collapse text-left text-sm">
		<caption class="text-muted px-4 pt-3 text-left text-xs">
			Checked {monthYear(CHECKED)} against each product’s own pages, sourced on each
			comparison. We make WattRoom.
		</caption>
		<thead>
			<tr class="border-muted/15 border-b">
				<th scope="col" class="w-40 px-4 py-3"></th>
				<th scope="col" class="font-display px-4 py-3">WattRoom</th>
				{#each rivals as r (r.slug)}
					<th scope="col" class="font-display px-4 py-3">
						<a href="/vs/{r.slug}" class="hover:underline">{r.name}</a>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.key)}
				<tr class="border-muted/10 border-b last:border-0">
					<th scope="row" class="text-muted px-4 py-3 align-top font-normal"
						>{row.label}</th
					>
					<td class="px-4 py-3 align-top">{OURS[row.key]}</td>
					{#each rivals as r (r.slug)}
						<td class="text-muted px-4 py-3 align-top">{r[row.key]}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
