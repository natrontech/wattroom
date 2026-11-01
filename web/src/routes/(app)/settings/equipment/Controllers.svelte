<script lang="ts">
	// Controllers (#4236): what a press runs while riding, a pad that shows
	// it live, and how a Zwift controller reaches WattRoom at all.
	import { shifterSlot } from '$lib/ble/controller-slot.svelte';
	import { isTyping } from '$lib/keys';
	import { KEY_TABLE } from '$lib/ride/keys';
	import { pressOfController, pressOfKey } from '$lib/ride/controller-test';

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
			if (edge === 'down') light(pressOfController(action), action);
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
