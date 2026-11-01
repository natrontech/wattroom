/**
 * House radio's sound (ADR-0094): the station's score, played on this
 * machine's AudioContext at server time. Mixed quiet and clean — the first
 * cut was too hot and the drum bus saturated (Dave, 2026-10-31) — and lofi
 * only through a low-pass, a slow tape wobble and a soft crackle.
 */
import {
	SLOT_SEC,
	drumsIn,
	melodyNote,
	sectionOf,
	tuneOf,
	type Chord,
	type Section,
	type Tune,
} from '$lib/lounge/station';
import { bass, lead } from '$lib/lounge/radio-voices';
import { organ, pad, piano, pluck } from '$lib/lounge/radio-keys';
import { brush, hat, kick, rim, snare } from '$lib/lounge/radio-drums';
import { OPEN_HZ, build, type Graph } from '$lib/lounge/radio-graph';
import { hash3 } from '$lib/lounge/hash';

/** How far ahead the scheduler lays notes down, in seconds. */
const AHEAD_SEC = 0.15;
/** The tone control's breakdown setting; open is the graph's. */
const SHUT_HZ = 1500;

/** Section changes the sound follows: fades between tunes, the breakdown's low-pass. */
function automate(g: Graph, tune: Tune, bar: number, t: number) {
	const lp = g.toneFilter.frequency;
	const tg = g.tuneGain.gain;
	if (bar === 0) {
		tg.cancelScheduledValues(t);
		tg.setValueAtTime(0.0001, t);
		tg.exponentialRampToValueAtTime(1, t + tune.barSec);
		g.echo.delayTime.setValueAtTime((0.75 * 60) / tune.bpm, t);
		g.crackle.gain.setTargetAtTime(tune.crackle, t, 0.5);
		lp.cancelScheduledValues(t);
		lp.setValueAtTime(900, t);
		lp.exponentialRampToValueAtTime(tune.open, t + tune.barSec * 4);
	}
	if (bar === tune.bars - 2) {
		tg.setValueAtTime(1, t);
		tg.exponentialRampToValueAtTime(0.0001, t + tune.barSec * 2);
	}
	const now = sectionOf(tune, bar);
	const before = sectionOf(tune, bar - 1);
	if (now === 'breakdown' && before !== 'breakdown') {
		lp.setValueAtTime(tune.open, t);
		lp.exponentialRampToValueAtTime(SHUT_HZ, t + tune.barSec);
	}
	if (now !== 'breakdown' && before === 'breakdown') {
		lp.setValueAtTime(SHUT_HZ, t);
		lp.exponentialRampToValueAtTime(tune.open, t + tune.barSec / 2);
	}
}

/** One sixteenth of one bar: everything that sounds on it. */
function playStep(g: Graph, tune: Tune, bar: number, s: number, at: number) {
	const section = sectionOf(tune, bar);
	const beat = 60 / tune.bpm;
	const h = (k: number) => hash3(tune.slot * 131 + bar, s, k);
	if (s === 0 && at >= g.ctx.currentTime) automate(g, tune, bar, at);
	const lean =
		s % 4 === 2
			? (tune.swing - 0.5) * beat
			: s % 2
				? (tune.swing - 0.5) * beat * 0.5
				: 0;
	const t = at + lean + (h(1) - 0.5) * 0.012;
	if (t < g.ctx.currentTime) return;
	const chord = tune.chords[bar % tune.chords.length];
	const next = tune.chords[(bar + 1) % tune.chords.length];
	const drums = drumsIn(section);
	keys(g, tune, chord, section, bar, s, t, h);
	if (section !== 'intro') bassStep(g, tune, chord, next, s, t, h);
	if (drums || (section === 'outro' && bar < tune.bars - 2)) {
		if (tune.kicks.includes(s) || (bar % 2 === 1 && s === 13 && h(6) < 0.3))
			kick(g, t, tune.kit === 'brush' ? 0.7 : 1);
	}
	if (drums) {
		const back = tune.halfTime ? s === 8 : s === 4 || s === 12;
		const hit = (vel: number) =>
			tune.kit === 'brush'
				? brush(g, t, vel)
				: tune.kit === 'rim'
					? rim(g, t, vel)
					: snare(g, t, vel);
		if (back) hit(0.9);
		else if ((bar - 4) % 8 === 7 && s >= 13) hit(0.35 + (s - 13) * 0.2);
		else if (s === 15 && h(7) < 0.25) hit(0.22);
	}
	if ((drums || section === 'breakdown') && (tune.hats16 || s % 2 === 0))
		hat(
			g,
			t,
			s % 4 === 0 ? 0.9 : s % 2 ? 0.35 + h(8) * 0.2 : 0.55 + h(8) * 0.3,
			s === 14 && h(9) < 0.3,
		);
	if (section === 'melody' && tune.melody && s % 2 === 0) {
		const note = melodyNote(tune, bar, s / 2, h(10) < 0.3);
		if (note !== null) lead(g, tune.lead, note, t, beat * 0.9);
	}
}

/** The chords in the tune's keys: struck, held, or broken into eighths. */
function keys(
	g: Graph,
	tune: Tune,
	chord: Chord,
	section: Section,
	bar: number,
	s: number,
	t: number,
	h: (k: number) => number,
) {
	const beat = 60 / tune.bpm;
	if (tune.keys === 'pad' || tune.keys === 'organ') {
		// Held instruments sound once a bar; the organ also on beat three.
		const strike = s === 0 || (tune.keys === 'organ' && s === 8 && bar % 2);
		if (!strike) return;
		const dur = tune.keys === 'pad' ? tune.barSec : tune.barSec / 2;
		for (const n of chord.notes)
			tune.keys === 'pad' ? pad(g, n, t, dur) : organ(g, n, t, dur * 0.9);
		return;
	}
	const strike = (n: number, at: number, vel: number, dur: number) =>
		tune.keys === 'pluck' ? pluck(g, n, at, vel) : piano(g, n, at, vel, dur);
	if (s % 2) return;
	if (tune.arp && (section === 'groove' || section === 'melody')) {
		const tone = tune.arp[s / 2];
		if (tone !== null)
			strike(
				chord.notes[tone % chord.notes.length],
				t,
				0.6 + h(2) * 0.2,
				beat * 0.9,
			);
		return;
	}
	if (!tune.comp.includes(s / 2)) return;
	const first = s === 0;
	chord.notes.forEach((n, i) =>
		strike(
			n,
			t + i * (first ? 0.016 : 0.008),
			first ? 0.9 : 0.55 + h(2) * 0.15,
			first ? tune.barSec * 0.9 : beat * 1.2,
		),
	);
}

/** The bass line in the tune's shape. */
function bassStep(
	g: Graph,
	tune: Tune,
	chord: Chord,
	next: Chord,
	s: number,
	t: number,
	h: (k: number) => number,
) {
	const beat = 60 / tune.bpm;
	const play = (note: number, dur: number, vel: number) =>
		bass(g, tune.bass, note, t, dur, vel);
	if (tune.bassLine === 'sparse') {
		if (s === 0) play(chord.bass, tune.barSec * 0.9, 1);
		return;
	}
	if (tune.bassLine === 'walk') {
		if (s % 4) return;
		const third = chord.notes.length ? chord.notes[0] % 12 : 0;
		const steps = [
			chord.bass,
			chord.bass + ((third - (chord.bass % 12) + 12) % 12),
			chord.bass + 7,
			next.bass + (h(5) < 0.5 ? -1 : 1),
		];
		play(steps[s / 4], beat * 0.9, s === 0 ? 1 : 0.75);
		return;
	}
	if (s === 0) play(chord.bass, beat * 1.7, 1);
	if (s === 8) play(h(3) < 0.5 ? chord.bass + 7 : chord.bass, beat * 1.2, 0.8);
	if (s === 14 && h(4) < 0.4)
		play(next.bass + (h(5) < 0.5 ? -1 : 2), beat * 0.4, 0.6);
}

/**
 * One station on this machine. `serverNowMs` is the jukebox's clock, so the
 * bar it plays is the bar every other screen plays.
 */
export function createHouseRadio(station: string, serverNowMs: () => number) {
	let g: Graph | null = null;
	let timer: ReturnType<typeof setInterval> | undefined;
	/** Server seconds minus the audio clock. */
	let offset = 0;
	let cursor = { slot: 0, bar: 0, s: 0 };

	function seat() {
		if (!g) return;
		offset = serverNowMs() / 1000 - g.ctx.currentTime;
		const at = g.ctx.currentTime + offset + 0.05;
		let slot = Math.floor(at / SLOT_SEC);
		const tune = tuneOf(station, slot);
		const into = at - slot * SLOT_SEC;
		let bar = Math.floor(into / tune.barSec);
		let s = Math.ceil((into - bar * tune.barSec) / (tune.barSec / 16));
		if (s >= 16) [bar, s] = [bar + 1, 0];
		if (bar >= tune.bars) [slot, bar, s] = [slot + 1, 0, 0];
		cursor = { slot, bar, s };
	}

	function schedule() {
		if (!g) return;
		// The server-clock estimate settles over the first ticks; follow it
		// when it moves by more than a nudge rather than drift from it.
		if (Math.abs(serverNowMs() / 1000 - g.ctx.currentTime - offset) > 0.05)
			seat();
		const horizon = g.ctx.currentTime + offset + AHEAD_SEC;
		for (;;) {
			const tune = tuneOf(station, cursor.slot);
			const at =
				cursor.slot * SLOT_SEC +
				cursor.bar * tune.barSec +
				(cursor.s * tune.barSec) / 16;
			if (at > horizon) break;
			playStep(g, tune, cursor.bar, cursor.s, at - offset);
			if (++cursor.s === 16) {
				cursor.s = 0;
				if (++cursor.bar >= tune.bars)
					cursor = { slot: cursor.slot + 1, bar: 0, s: 0 };
			}
		}
	}

	return {
		/** Start, or keep, playing. Safe to call again. */
		start() {
			if (!g) g = build(new AudioContext());
			void g.ctx.resume();
			if (timer) return;
			seat();
			const now = g.ctx.currentTime;
			g.tuneGain.gain.cancelScheduledValues(now);
			g.tuneGain.gain.setValueAtTime(1, now);
			g.toneFilter.frequency.cancelScheduledValues(now);
			g.toneFilter.frequency.setValueAtTime(OPEN_HZ, now);
			timer = setInterval(schedule, 25);
		},
		/** Stop laying down notes; what is already scheduled rings out under the fader. */
		stop() {
			clearInterval(timer);
			timer = undefined;
		},
		/** The fader times the duck, 0–1, gliding over `ms`. */
		setLevel(value: number, ms = 0) {
			if (!g) return;
			const now = g.ctx.currentTime;
			g.level.gain.cancelScheduledValues(now);
			g.level.gain.setTargetAtTime(value, now, Math.max(0.01, ms / 3000));
		},
		setRain(on: boolean) {
			g?.rain.gain.setTargetAtTime(on ? 0.05 : 0, g.ctx.currentTime, 0.6);
		},
		/** Resume after the browser held the context back for want of a gesture. */
		resume() {
			void g?.ctx.resume();
		},
		close() {
			clearInterval(timer);
			timer = undefined;
			void g?.ctx.close();
			g = null;
		},
	};
}

export type HouseRadio = ReturnType<typeof createHouseRadio>;
