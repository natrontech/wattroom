<script lang="ts">
	// The crew-ride when-picker (#180): rides get planned days ahead, not
	// months — a chip per day this week plus a time field covers the 95 %,
	// in the kit's language instead of the browser's grey popup.
	let {
		value = $bindable(''),
	}: {
		/** datetime-local format (YYYY-MM-DDTHH:MM), like the input it replaces. */
		value?: string;
	} = $props();

	const days = $derived.by(() => {
		const out: { label: string; date: string }[] = [];
		const today = new Date();
		for (let i = 0; i < 7; i++) {
			const d = new Date(today);
			d.setDate(today.getDate() + i);
			out.push({
				label:
					i === 0
						? 'Today'
						: i === 1
							? 'Tomorrow'
							: d.toLocaleDateString(undefined, { weekday: 'short' }),
				date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
			});
		}
		return out;
	});

	const picked = $derived(value.split('T')[0] ?? '');
	const time = $derived(value.split('T')[1] ?? '19:00');

	function setDay(date: string) {
		value = `${date}T${time}`;
	}
	function setTime(raw: string) {
		const clock = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
		if (!clock) return;
		value = `${picked || days[0].date}T${String(clock[1]).padStart(2, '0')}:${clock[2]}`;
	}
</script>

<div class="flex flex-wrap items-center gap-1.5">
	{#each days as day (day.date)}
		<button
			type="button"
			onclick={() => setDay(day.date)}
			class="rounded border px-2.5 py-1.5 text-xs {picked === day.date
				? 'border-neon/60 text-white'
				: 'border-muted/25 text-muted hover:text-white'}">{day.label}</button
		>
	{/each}
	<input
		value={time}
		onchange={(e) => {
			setTime(e.currentTarget.value);
			e.currentTarget.value = value.split('T')[1] ?? time;
		}}
		aria-label="Time"
		class="border-muted/25 focus:border-muted/60 w-16 rounded border bg-transparent px-2 py-1.5 text-center font-mono text-xs tabular-nums outline-none"
	/>
</div>
