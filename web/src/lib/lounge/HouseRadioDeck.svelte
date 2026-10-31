<script lang="ts">
	// House radio on the deck (ADR-0094): queued like a track, heard on every
	// page of the voice channel the way a library track is, from the crew and
	// the server clock rather than a file. A rider who opted out on this
	// device, sat out the deck or stepped away hears nothing, and their
	// browser builds no audio for it at all.
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { listening } from '$lib/channel/listening.svelte';
	import { serverNow } from '$lib/server-clock';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { onDuck } from '$lib/sound/duck';
	import { createHouseRadio, type HouseRadio } from '$lib/lounge/house-radio';
	import { radioHeard } from '$lib/lounge/radio-heard.svelte';
	import { weatherOf } from '$lib/lounge/state';

	const conn = $derived(channelConnection.current);
	const deck = $derived(conn?.live.tick?.jukebox);
	const station = $derived(conn?.address.crew ?? '');
	const on = $derived(
		!!deck?.current?.radio &&
			deck.playing &&
			radioHeard.current &&
			!listening.out &&
			!mixer.muted &&
			mixer.music > 0,
	);

	// One station per crew, made only once it is first heard.
	let radio = $state.raw<HouseRadio | null>(null);
	$effect(() => {
		if (!on || !station) return;
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
	$effect(() => radio?.setRain(weatherOf(conn?.live.tick?.lounge) === 'rain'));
	// A context made before any click starts suspended; the first one wakes it.
	$effect(() => {
		const wake = () => radio?.resume();
		window.addEventListener('pointerdown', wake, { once: true });
		return () => window.removeEventListener('pointerdown', wake);
	});
</script>
