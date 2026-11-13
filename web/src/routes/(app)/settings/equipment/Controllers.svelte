<script lang="ts">
	// Controllers (#4236, #4563): one table of what WattRoom does, the key
	// and the Click V2 button that run it, a press of either lighting its
	// row, and one way to set a Zwift controller up.
	import { shifterSlot } from '#lib/ble/controller-slot.svelte.ts';
	import { obcNet } from '#lib/ble/obc-net.svelte.ts';
	import { isTyping } from '#lib/keys.ts';
	import { pressOfController, pressOfKey } from '#lib/ride/controller-test.ts';
	import { controlsTable, keystrokeMap } from '#lib/ride/controls-table.ts';

	const ROWS = controlsTable();
	const KEYSTROKES = keystrokeMap();

	let lit = $state<string | null>(null);
	let from = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	function light(does: string, source: string) {
		lit = does;
		from = source;
		clearTimeout(timer);
		timer = setTimeout(() => (lit = null), 1200);
	}
	$effect(() => {
		const down = (event: KeyboardEvent) => {
			if (event.repeat || isTyping(event)) return;
			const does = pressOfKey(event);
			if (does) light(does, event.key === ' ' ? 'Space' : event.key);
		};
		window.addEventListener('keydown', down);
		const off = shifterSlot.onAction((action, edge) => {
			if (edge === 'down') light(pressOfController(action), 'The controller');
		});
		return () => {
			window.removeEventListener('keydown', down);
			off();
			clearTimeout(timer);
		};
	});
</script>

<section class="panel panel-xl mt-8">
	<h2 class="font-display font-bold">Keys and controller buttons</h2>
	<p class="text-muted mt-1 text-sm">
		Press a key, a clicker or a controller's button: what it runs while you ride
		lights up. Controller is the Zwift Click V2's button over BikeControl's
		network mode.
	</p>
	<table class="mt-4 w-full text-left" data-testid="controller-pad">
		<thead class="text-muted text-sm">
			<tr>
				<th class="pr-4 pb-1 font-normal">Runs</th>
				<th class="pr-4 pb-1 font-normal">Key</th>
				<th class="pb-1 font-normal">Controller</th>
			</tr>
		</thead>
		<tbody>
			{#each ROWS as row (row.does)}
				{@const on = lit === row.does}
				<tr class="border-ink/10 border-t {on ? 'text-ink font-semibold' : ''}">
					<td class="py-1.5 pr-4 text-sm {on ? '' : 'text-muted'}"
						>{row.does}</td
					>
					<td class="py-1.5 pr-4 whitespace-nowrap">
						{#if row.key}
							<kbd
								class="num rounded border px-2 py-0.5 text-sm {on
									? 'border-neon text-ink'
									: 'border-ink/15 text-muted'}">{row.key}</kbd
							>
						{:else}<span class="text-muted">–</span>{/if}
					</td>
					<td class="py-1.5 whitespace-nowrap">
						{#each row.controller as button (button)}
							<kbd
								class="num mr-1 inline-block min-w-7 rounded border px-1.5 text-center text-sm {on
									? 'border-neon text-ink'
									: 'border-ink/15 text-muted'}">{button}</kbd
							>
						{:else}<span class="text-muted text-sm"
								>{row.sends.join(', ') || '–'}</span
							>{/each}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="text-muted mt-3 min-h-5 text-sm" aria-live="polite">
		{#if lit}{from} runs {lit}.{/if}
	</p>

	<h3 class="ride-label mt-6">A Zwift Click, Play or Ride</h3>
	<p class="text-muted mt-1 text-sm leading-relaxed">
		They speak Zwift's own protocol, so BikeControl bridges them to WattRoom.
	</p>
	<ol
		class="text-muted mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed"
	>
		<li>Install BikeControl and pair your Zwift controllers to it.</li>
		<li>Turn on its OpenBikeControl network mode.</li>
		<li>
			{#if obcNet.available}
				Pair Network shifter beside your sensors.
			{:else}
				Pair Network shifter in the <a href="/download" class="underline"
					>desktop app</a
				>, beside your sensors.
			{/if}
		</li>
	</ol>
	<p class="text-muted mt-2 text-xs leading-relaxed">
		BikeControl is free for a few days, then limits you to 15 presses a day
		until you buy it. A Click V2 or Ride V2 also needs connecting in Zwift's own
		app once a day.
	</p>
	<details class="mt-4">
		<summary class="text-muted cursor-pointer text-sm">No network mode?</summary
		>
		<p class="text-muted mt-2 text-sm leading-relaxed">
			Use BikeControl's keystroke mode with the Rouvy or TrainingPeaks Virtual
			preset, and give the Click V2's buttons these keys. They run what the
			table says.
		</p>
		<table class="mt-2 text-sm">
			<thead class="text-muted text-left">
				<tr>
					<th class="pr-6 font-normal">Button</th>
					<th class="font-normal">Key</th>
				</tr>
			</thead>
			<tbody>
				{#each KEYSTROKES as [button, key] (button)}
					<tr>
						<td class="pr-6">{button}</td>
						<td><kbd class="num">{key}</kbd></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</details>
</section>
