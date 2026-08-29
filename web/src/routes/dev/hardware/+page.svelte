<script lang="ts">
	import { FtmsTrainer } from '$lib/ble/ftms';
	import type { TrainerSample, TrainerStatus } from '$lib/ble/trainer';
	import { formatClock } from '../room/mockRoom.svelte';

	/**
	 * The M0 hardware session (#10) in one page: pair a real trainer, prove power and
	 * cadence arrive, prove ERG holds a target, and log every GATT step so a failure
	 * is diagnosable without a debugger attached to a sweating rider.
	 */
	let trainer: FtmsTrainer | undefined;
	let status = $state<TrainerStatus>('disconnected');
	let deviceName = $state('');
	let sample = $state<TrainerSample | null>(null);
	let target = $state(150);
	let samples = $state(0);
	let speed = $state<number | null>(null);
	let lastAck = $state<number | null>(null);
	let log = $state<{ at: string; text: string; bad?: boolean }[]>([]);
	let started = 0;

	function note(text: string, bad = false) {
		const at = started ? formatClock((Date.now() - started) / 1000) : '0:00';
		log = [{ at, text, bad }, ...log].slice(0, 40);
	}

	async function pair() {
		started = Date.now();
		log = [];
		trainer = new FtmsTrainer();
		trainer.onStatus((next) => {
			status = next;
			note(`status: ${next}`);
		});
		trainer.onSample((next) => {
			sample = next;
			speed = trainer?.lastFrame.speedKph ?? null;
			samples += 1;
		});
		trainer.onLog((text, ms) => {
			if (ms !== undefined) lastAck = ms;
			note(ms === undefined ? text : `${text} in ${ms} ms`);
		});
		try {
			note('requesting device — pick your trainer in the browser dialog');
			await trainer.connect();
			deviceName = trainer.name;
			note(`connected to ${trainer.name}, control granted`);
		} catch (error) {
			note(error instanceof Error ? error.message : String(error), true);
		}
	}

	async function sendTarget() {
		try {
			await trainer?.setTargetPower(target);
			note(`set target power → ${target} W`);
		} catch (error) {
			note(error instanceof Error ? error.message : String(error), true);
		}
	}

	async function sendGrade(grade: number) {
		try {
			await trainer?.setSimulation(grade);
			note(`set simulation → ${grade}% grade`);
		} catch (error) {
			note(error instanceof Error ? error.message : String(error), true);
		}
	}

	const connected = $derived(status === 'connected');
	const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;
</script>

<main class="mx-auto max-w-3xl px-6 py-10">
	<h1 class="font-display text-3xl font-bold tracking-tight">
		Hardware session
	</h1>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		#10: pair a real trainer over FTMS, confirm power and cadence arrive,
		confirm ERG holds a target. Chrome or Edge only — Web Bluetooth needs a user
		gesture, so nothing here can auto-connect.
	</p>

	{#if !supported}
		<div class="border-z5/40 bg-z5/10 mt-6 rounded-lg border px-5 py-4 text-sm">
			This browser has no Web Bluetooth. Use Chrome or Edge on desktop.
		</div>
	{/if}

	<div class="mt-6 flex flex-wrap items-center gap-3">
		<button
			onclick={pair}
			disabled={!supported || status === 'connecting'}
			class="rounded bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-40"
			>{connected ? 'Re-pair' : 'Pair trainer'}</button
		>
		{#if connected}
			<button
				onclick={() => trainer?.disconnect()}
				class="border-muted/30 hover:border-muted/60 rounded border px-4 py-3 text-sm"
				>Disconnect</button
			>
		{/if}
		<span class="text-muted font-mono text-xs">{deviceName || status}</span>
	</div>

	<div
		class="border-muted/15 bg-surface-raised mt-4 grid grid-cols-3 gap-6 rounded-lg border p-6"
	>
		<div>
			<div
				class="text-watt glow-text-strong font-display text-5xl leading-none font-bold tabular-nums"
			>
				{sample?.watts ?? '—'}
			</div>
			<div class="text-muted mt-2 text-[10px] tracking-wider uppercase">
				watts
			</div>
		</div>
		<div>
			<div
				class="font-display text-3xl leading-none font-semibold tabular-nums"
			>
				{sample?.cadence ?? '—'}
			</div>
			<div class="text-muted mt-2 text-[10px] tracking-wider uppercase">
				rpm
			</div>
		</div>
		<div>
			<div
				class="font-display text-3xl leading-none font-semibold tabular-nums"
			>
				{samples}
			</div>
			<div class="text-muted mt-2 text-[10px] tracking-wider uppercase">
				samples
			</div>
		</div>
	</div>

	<div class="border-muted/15 mt-3 rounded-lg border p-6">
		<h2 class="font-display font-bold">ERG</h2>
		<p class="text-muted mt-1 text-xs">
			Set a target and confirm the trainer holds it regardless of gear. This is
			the test that matters — a Zwift Cog gives you one ratio, and ERG should
			not care.
		</p>
		<div class="mt-4 flex flex-wrap items-center gap-3">
			<input
				type="number"
				bind:value={target}
				min="50"
				max="600"
				step="10"
				class="border-muted/25 w-28 rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums"
			/>
			<button
				onclick={sendTarget}
				disabled={!connected}
				class="rounded bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
				>Set target</button
			>
			{#each [100, 150, 200, 250] as preset (preset)}
				<button
					onclick={() => ((target = preset), sendTarget())}
					disabled={!connected}
					class="border-muted/25 hover:border-muted/60 rounded border px-3 py-2 text-xs disabled:opacity-40"
					>{preset} W</button
				>
			{/each}
		</div>

		<h2 class="font-display mt-6 font-bold">Slope</h2>
		<p class="text-muted mt-1 text-xs">
			What sprint moments use. On a single-cog setup expect a narrow usable
			range — you cannot shift to meet the grade.
		</p>
		<div class="mt-3 flex flex-wrap gap-2">
			{#each [0, 2, 5, 8] as grade (grade)}
				<button
					onclick={() => sendGrade(grade)}
					disabled={!connected}
					class="border-muted/25 hover:border-muted/60 rounded border px-3 py-2 text-xs disabled:opacity-40"
					>{grade}%</button
				>
			{/each}
		</div>
	</div>

	<div class="border-muted/15 mt-3 rounded-lg border p-6">
		<h2 class="font-display font-bold">GATT log</h2>
		<ul class="mt-3 space-y-1 font-mono text-[11px]">
			{#each log as entry, i (i)}
				<li class="flex gap-3">
					<span class="text-muted/60 tabular-nums">{entry.at}</span>
					<span class={entry.bad ? 'text-z6' : 'text-muted'}>{entry.text}</span>
				</li>
			{:else}
				<li class="text-muted">Nothing yet — hit Pair.</li>
			{/each}
		</ul>
	</div>
</main>
