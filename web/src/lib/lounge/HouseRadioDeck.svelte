<script lang="ts">
	// House radio on the deck (ADR-0094): queued like a track, heard on every
	// page of the voice channel the way a library track is, from the crew and
	// the server clock rather than a queue. Records, the default, are real
	// tracks in an <audio> element, as AudioDeck plays a pool track; the other
	// styles are generated. A rider who opted out on this device, sat out the
	// deck or stepped away hears nothing, and their browser builds no audio
	// for it at all.
	import { channelConnection } from '#lib/channel/connection.svelte.ts';
	import { listening } from '#lib/channel/listening.svelte.ts';
	import { serverNow } from '#lib/server-clock.ts';
	import { mixer } from '#lib/sound/mixer.svelte.ts';
	import { onDuck } from '#lib/sound/duck.ts';
	import {
		createHouseRadio,
		type HouseRadio,
	} from '#lib/lounge/house-radio.ts';
	import { radioHeard } from '#lib/lounge/radio-heard.svelte.ts';
	import {
		radioSrc,
		recordAt,
		type RecordPosition,
	} from '#lib/lounge/records.ts';
	import { radioPickOf, stationPick, weatherOf } from '#lib/lounge/state.ts';

	/** Past this, assign rather than let it ride: AudioDeck's bar. */
	const DRIFT_SEC = 0.6;

	const conn = $derived(channelConnection.call);
	const deck = $derived(conn?.live.tick?.jukebox);
	const station = $derived(conn?.address.crew ?? '');
	const lounge = $derived(conn?.live.tick?.lounge);
	const pick = $derived(radioPickOf(lounge));
	/** The channel's skips (Next track), and the stove's slower tunes. */
	const shift = $derived(lounge?.radioShiftMs ?? 0);
	const slow = $derived(!!lounge?.fire);
	const on = $derived(
		!!deck?.current?.radio &&
			deck.playing &&
			radioHeard.current &&
			!listening.out &&
			!mixer.muted &&
			mixer.music > 0 &&
			!!station,
	);
	// A shelf this server cannot serve (a dev checkout without `make radio`)
	// plays the mix here rather than nothing.
	// ponytail: one failed load gives up on records until reload; ask with a
	// HEAD first, as AudioDeck does, if riders on flaky links lose them.
	let shelfMissing = $state(false);
	const records = $derived(pick === '' && !shelfMissing);

	// One generated station per crew, made only once it is first heard.
	let radio = $state.raw<HouseRadio | null>(null);
	$effect(() => {
		if (!on || records) return;
		const made = createHouseRadio(station, serverNow);
		radio = made;
		return () => {
			made.close();
			radio = null;
		};
	});
	$effect(() => {
		if (!radio) return;
		radio.start();
		const ceiling = mixer.music / 100;
		const depth = mixer.duck;
		return onDuck(({ down, ms }) =>
			radio?.setLevel(down ? ceiling * depth : ceiling, ms),
		);
	});
	$effect(() => radio?.setRain(weatherOf(lounge) === 'rain'));
	// The style anyone in the channel picked, their skips and the stove.
	$effect(() => radio?.tune(stationPick(pick), shift, slow));
	// A context made before any click or key starts suspended; the first one
	// wakes it.
	$effect(() => {
		const wake = () => radio?.resume();
		window.addEventListener('pointerdown', wake, { once: true });
		window.addEventListener('keydown', wake, { once: true });
		return () => {
			window.removeEventListener('pointerdown', wake);
			window.removeEventListener('keydown', wake);
		};
	});

	// Records: the record and the second every screen plays, chased each
	// second the way AudioDeck chases the deck's playhead.
	let audio = $state<HTMLAudioElement | null>(null);
	let now = $state.raw<RecordPosition | null>(null);
	$effect(() => {
		if (!on || !records) {
			now = null;
			return;
		}
		// Writes `now` and never reads it back, so the effect does not wake
		// itself. A skip changes `shift` and steps at once.
		const ahead = shift;
		const step = () => {
			const pos = recordAt(station, (serverNow() + ahead) / 1000);
			now = pos;
			const el = audio;
			if (!el || !el.src.endsWith(radioSrc(pos.record.file))) return;
			if (pos.at * 1000 >= pos.record.ms) {
				if (!el.paused) el.pause();
				return;
			}
			if (Math.abs(el.currentTime - pos.at) > DRIFT_SEC)
				el.currentTime = pos.at;
			// Refused before the rider's first click or key; the next step retries.
			if (el.paused) void el.play().catch(() => {});
		};
		step();
		const every = setInterval(step, 1000);
		return () => clearInterval(every);
	});
	$effect(() => {
		const el = audio;
		if (!el) return;
		const ceiling = mixer.music / 100;
		const depth = mixer.duck;
		return onDuck(({ down }) => {
			el.volume = Math.max(0, Math.min(1, down ? ceiling * depth : ceiling));
		});
	});
</script>

{#if now}
	<audio
		bind:this={audio}
		src={radioSrc(now.record.file)}
		preload="auto"
		onerror={() => (shelfMissing = true)}
	></audio>
{/if}
