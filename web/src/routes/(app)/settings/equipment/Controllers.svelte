<script lang="ts">
	// Controllers (#4236): what a press runs while riding, a pad that shows
	// it live, and how a Zwift controller reaches WattRoom at all.
	import { shifterSlot } from '#lib/ble/controller-slot.svelte.ts';
	import { obcNet } from '#lib/ble/obc-net.svelte.ts';
	import { gearsEnabled } from '#lib/ride/gears-enabled.ts';
	import { isTyping } from '#lib/keys.ts';
	import { KEY_TABLE } from '#lib/ride/keys.ts';
	import { pressOfController, pressOfKey } from '#lib/ride/controller-test.ts';
	import { obcLegend } from '#lib/ble/obc-legend.ts';
	import type { ObcAction } from '#lib/ble/obc.ts';

	/** A two-controller set bridged as keys: the left one's arrows, the right one's letters. */
	const ZWIFT_MAP: [button: string, key: string, does: string][] = [
		['Left shift', ',', 'Easier'],
		['Right shift', '.', 'Harder'],
		['← →', '← →', 'Computer page'],
		['↑', 'M', 'Map page, and back'],
		['↓', 'H', 'Clean view'],
		['A', 'V', '3D or Flat'],
		['B', '1', 'Chase camera'],
		['Y', '2', 'Overhead camera'],
		['Z', '3', 'Side camera'],
	];

	/** What each OpenBikeControl action runs here (#4547), from OBC_BUTTONS. */
	const LEGEND = obcLegend();

	let lit = $state<string | null>(null);
	let from = $state('');
	/** The controller action that lit the pad: its legend row lights too. */
	let litAction = $state<ObcAction | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	function light(
		does: string,
		source: string,
		action: ObcAction | null = null,
	) {
		lit = does;
		from = source;
		litAction = action;
		clearTimeout(timer);
		timer = setTimeout(() => {
			lit = null;
			litAction = null;
		}, 1200);
	}
	$effect(() => {
		const down = (event: KeyboardEvent) => {
			if (event.repeat || isTyping(event)) return;
			const does = pressOfKey(event);
			if (does) light(does, event.key === ' ' ? 'Space' : event.key);
		};
		window.addEventListener('keydown', down);
		const off = shifterSlot.onAction((action, edge) => {
			if (edge === 'down') light(pressOfController(action), action, action);
		});
		return () => {
			window.removeEventListener('keydown', down);
			off();
			clearTimeout(timer);
		};
	});
</script>

<section class="panel panel-xl mt-8">
	<h2 class="font-display font-bold">Try a button</h2>
	<p class="text-muted mt-1 text-sm">
		Press a key, a clicker or a controller's button: what it runs while you ride
		lights up.
	</p>
	<dl
		data-testid="controller-pad"
		class="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1"
	>
		{#each KEY_TABLE as [keys, does] (keys)}
			<dt>
				<kbd
					class="num rounded border px-2 py-1 text-sm {lit === does
						? 'border-neon text-ink'
						: 'border-ink/15 text-muted'}">{keys}</kbd
				>
			</dt>
			<dd
				class="text-sm {lit === does ? 'text-ink font-semibold' : 'text-muted'}"
			>
				{does}
			</dd>
		{/each}
	</dl>
	<p class="text-muted mt-3 min-h-5 text-sm" aria-live="polite">
		{#if lit}{from} runs {lit}.{/if}
	</p>
</section>

<section class="panel panel-xl mt-8">
	<h2 class="font-display font-bold">Zwift Click, Play and Ride</h2>
	<p class="text-muted mt-1 text-sm leading-relaxed">
		They speak Zwift's own protocol, which WattRoom does not, so they never show
		under Shifter. BikeControl bridges them: it pairs the controllers and types
		keys WattRoom reads.
	</p>
	<ol
		class="text-muted mt-3 list-decimal space-y-1 pl-5 text-sm leading-relaxed"
	>
		<li>Install BikeControl and pair your Zwift controllers to it.</li>
		<li>
			Choose keystroke mode with the Rouvy or TrainingPeaks Virtual preset: its
			shift buttons send <kbd>,</kbd> and <kbd>.</kbd>, Easier and Harder here.
		</li>
		<li>Give the other buttons the keys below, then try them above.</li>
	</ol>
	{#if gearsEnabled('obc-net')}
		<!-- #3349: the network shifter is the shell's alone, so a browser
		     hears where it is, and the shell where its card shows. -->
		<p class="text-muted mt-3 text-sm leading-relaxed">
			{#if obcNet.available}
				Or skip the keys: turn on BikeControl's OpenBikeControl network mode,
				then pair Network shifter beside your sensors.
			{:else}
				Or skip the keys in the
				<a href="/download" class="underline">desktop app</a>: BikeControl's
				OpenBikeControl network mode pairs there as Network shifter.
			{/if}
		</p>
	{/if}
	<h3 class="ride-label mt-4">A two-controller set</h3>
	<table class="mt-2 text-sm">
		<thead class="text-muted text-left">
			<tr>
				<th class="pr-6 font-normal">Button</th>
				<th class="pr-6 font-normal">Key</th>
				<th class="font-normal">Runs</th>
			</tr>
		</thead>
		<tbody>
			{#each ZWIFT_MAP as [button, key, does] (button)}
				<tr>
					<td class="pr-6">{button}</td>
					<td class="pr-6"><kbd class="num">{key}</kbd></td>
					<td class="text-muted">{does}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="text-muted mt-3 text-xs">
		The road holds your line: the arrows turn the computer's pages.
	</p>
</section>

{#if gearsEnabled('obc') || gearsEnabled('obc-net')}
	<!-- #4547: what each OpenBikeControl action runs here, so a rider can
	     tell a wired button from one WattRoom ignores. -->
	<section class="panel panel-xl mt-8">
		<h2 class="font-display font-bold">Controller buttons</h2>
		<p class="text-muted mt-1 text-sm">
			What a Shifter or Network shifter runs for each action it sends. Click V2
			is the button BikeControl puts it on for a Zwift Click V2.
		</p>
		<table class="mt-4 w-full text-left" data-testid="controller-legend">
			<thead class="text-muted text-sm">
				<tr>
					<th class="pr-4 pb-1 font-normal">Runs</th>
					<th class="pr-4 pb-1 font-normal">Click V2</th>
					<th class="pb-1 font-normal">Action</th>
				</tr>
			</thead>
			<tbody>
				{#each LEGEND as row (row.action)}
					{@const on = litAction === row.action}
					<tr
						class="border-ink/10 border-t {on ? 'text-ink font-semibold' : ''}"
					>
						<td class="py-1.5 pr-4">{row.does}</td>
						<td class="py-1.5 pr-4 whitespace-nowrap">
							{#each row.click as button (button)}
								<kbd
									class="num mr-1 inline-block min-w-7 rounded border px-1.5 text-center {on
										? 'border-neon'
										: 'border-ink/15'}">{button}</kbd
								>
							{:else}
								<span class="text-muted">–</span>
							{/each}
						</td>
						<td class="text-muted py-1.5 text-sm">{row.sends.join(', ')}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="text-muted mt-3 text-sm">
			To put an action on a different button, change it in BikeControl.
		</p>
	</section>
{/if}
