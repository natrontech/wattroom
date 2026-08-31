<script lang="ts">
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { enumerateGatt, type GattDump } from '$lib/ble/enumerate';
	import { hwlog } from '$lib/ble/hwlog';
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
		// The on-screen list is for the rider; the file is the evidence.
		hwlog(bad ? 'error' : 'event', { text, elapsed: at });
	}

	// A reload no longer hides that a reload happened.
	$effect(() => hwlog('page-loaded', { ua: navigator.userAgent }));

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
			hwlog('sample', {
				watts: next.watts,
				cadence: next.cadence,
				speedKph: trainer?.lastFrame.speedKph,
				heartRate: trainer?.lastFrame.heartRate,
				target,
				mode: trainer?.mode,
			});
		});
		trainer.onLog((text, ms) => {
			if (ms !== undefined) lastAck = ms;
			note(ms === undefined ? text : `${text} in ${ms} ms`);
			if (ms !== undefined) hwlog('control-ack', { ms });
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

	let dump = $state<GattDump | null>(null);
	let dumping = $state(false);

	/**
	 * The Kickr v2 question (#10): RESEARCH.md §9 presumes WCPS-only from firmware
	 * notes. This answers it from the device itself.
	 */
	async function enumerate() {
		dumping = true;
		dump = null;
		started = started || Date.now();
		try {
			note('enumerating GATT — pick the trainer in the dialog');
			const result = await enumerateGatt((text) => note(text));
			dump = result;
			hwlog('gatt-dump', result as unknown as Record<string, unknown>);
			note(
				`dump complete: ${result.services.length} services · FTMS ${result.hasFtms ? 'present' : 'ABSENT'} · WCPS ${result.hasWcps ? 'present' : 'absent'}`,
			);
		} catch (error) {
			note(error instanceof Error ? error.message : String(error), true);
		} finally {
			dumping = false;
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
			class="bg-ink text-paper hover:bg-ink/90 rounded px-5 py-3 text-sm font-semibold disabled:opacity-40"
			>{connected ? 'Re-pair' : 'Pair trainer'}</button
		>
		{#if connected}
			<button
				onclick={() => trainer?.disconnect()}
				class="border-muted/30 hover:border-muted/60 rounded border px-4 py-3 text-sm"
				>Disconnect</button
			>
		{/if}
		<button
			onclick={enumerate}
			disabled={!supported || dumping}
			class="border-muted/30 hover:border-muted/60 rounded border px-4 py-3 text-sm disabled:opacity-40"
			>{dumping ? 'Enumerating…' : 'Dump GATT'}</button
		>
		<span class="text-muted font-mono text-xs">{deviceName || status}</span>
	</div>

	{#if dump}
		<section
			class="border-muted/15 bg-surface-raised mt-4 rounded-lg border p-6"
		>
			<div class="flex flex-wrap items-baseline gap-4">
				<h2 class="font-display font-bold">{dump.device}</h2>
				<span
					class="rounded px-2 py-0.5 text-xs {dump.hasFtms
						? 'bg-z4/20 text-z4'
						: 'bg-z6/20 text-z6'}"
					>FTMS {dump.hasFtms ? 'present' : 'absent'}</span
				>
				<span
					class="rounded px-2 py-0.5 text-xs {dump.hasWcps
						? 'bg-z4/20 text-z4'
						: 'bg-surface text-muted'}"
					>WCPS {dump.hasWcps ? 'present' : 'absent'}</span
				>
				<span class="text-muted ml-auto font-mono text-[11px]"
					>{dump.services.length} services</span
				>
			</div>

			<!-- The limit is worth stating on screen: absence here is not proof of absence. -->
			<p class="text-muted mt-3 text-xs">
				Web Bluetooth only exposes services declared up front, so anything
				outside the probe list in <code class="text-ink/70">enumerate.ts</code> is
				invisible — a missing service means "not one we asked for", not necessarily
				"not there".
			</p>

			<div class="mt-5 space-y-4">
				{#each dump.services as service (service.uuid)}
					<div>
						<p class="font-mono text-xs">
							<span class="text-ink">{service.name ?? 'unknown service'}</span>
							<span class="text-muted"> · {service.uuid}</span>
						</p>
						{#if service.error}
							<p class="text-z6 mt-1 font-mono text-[11px]">{service.error}</p>
						{/if}
						<ul class="mt-1.5 space-y-1">
							{#each service.characteristics as char (char.uuid)}
								<li class="text-muted font-mono text-[11px] leading-relaxed">
									<span class="text-ink/80">{char.name ?? char.uuid}</span>
									<span class="text-muted/70">
										[{char.properties.join(' ')}]</span
									>
									{#if char.text}
										<span class="text-watt"> “{char.text}”</span>
									{:else if char.value}
										<span class="text-muted/60"> {char.value}</span>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<div
		class="border-muted/15 bg-surface-raised mt-4 grid grid-cols-2 gap-6 rounded-lg border p-6 sm:grid-cols-5"
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
				{speed !== null ? speed.toFixed(1) : '—'}
			</div>
			<!-- Slope resistance is derived from this, so a tall single cog makes 2% brutal. -->
			<div class="text-muted mt-2 text-[10px] tracking-wider uppercase">
				kph (virtual)
			</div>
		</div>
		<div>
			<div
				class="font-display text-3xl leading-none font-semibold tabular-nums"
			>
				{lastAck !== null ? lastAck : '—'}
			</div>
			<div class="text-muted mt-2 text-[10px] tracking-wider uppercase">
				ack ms
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
				class="bg-ink text-paper rounded px-4 py-2 text-sm font-medium disabled:opacity-40"
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
