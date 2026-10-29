import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { Trainer } from '$lib/ble/trainer';
import { channelConnection } from '$lib/channel/connection.svelte';
import { askToEndWorkout, askToStopRamp } from '$lib/ride/end-ride';
import { dockScreen, drawsTheRide } from '$lib/ride/ride-screens';
import { statusLine, trainerLine } from '$lib/ride/status-lines';
import { theRide } from '$lib/ride/the-ride.svelte';

// The riding screen the rider last had open (ADR-0093 point 5): where Open
// and End ride go. /ride until a ride has been seen on another.
let screen = $state('/ride');

/**
 * The ride dock's reading of the ride alone (ADR-0093 point 5): a workout's
 * session or a free ride on a road, whichever `theRide` holds. The dock in
 * the sidebar and its short form in a phone's top bar both read it.
 */
export const rideDock = {
	get screen() {
		return dockScreen(screen, channelConnection.current?.address.training);
	},
	/** A page the rider opened: a riding screen drawing the live ride is the one to go back to. */
	saw(pathname: string) {
		if (theRide.live && drawsTheRide(pathname)) screen = pathname;
	},
	/** Time ridden: a workout's clock, or the free ride's. */
	get seconds(): number {
		return theRide.road?.free.seconds ?? theRide.session?.elapsed ?? 0;
	},
	get watts(): number {
		return theRide.road
			? theRide.road.watts
			: (theRide.session?.sample?.watts ?? 0);
	},
	/** The trainer went quiet: the watts are not live. */
	get stale(): boolean {
		return theRide.road ? theRide.road.stale : theRide.signalLost;
	},
	/**
	 * The ride's critical status (errors.md: persistent, never a toast): the
	 * trainer lost, with its one button, then no crash safety, with none.
	 */
	get status(): {
		text: string;
		alert: boolean;
		action?: string;
		name?: string;
	} | null {
		const session = theRide.session;
		if (rideDock.stale)
			return {
				...trainerLine(
					!theRide.road && session?.trainerStatus !== 'connected'
						? 'reconnecting'
						: 'silent',
				),
				alert: true,
			};
		if (!theRide.road && theRide.noCrashSafety)
			return { text: statusLine('no-crash-copy').text, alert: false };
		return null;
	},
	/** Ride on with the trainer the chooser picked (#1847). */
	repair(next: Trainer) {
		if (theRide.road) theRide.road.solo.repair(next);
		else theRide.session?.repair(next);
	},
	/**
	 * The riding screen's End ride, from the dock: a workout asks first, as
	 * there (#2623), and either ends on its closing card there. The count-in
	 * has nothing ridden yet, so it only cancels, as its screen's Cancel does.
	 */
	async end() {
		const session = theRide.session;
		const road = theRide.road;
		const ramp = theRide.ramp;
		if (session?.state === 'countdown') return theRide.cancelCountdown();
		const ask = road ? null : ramp ? askToStopRamp : askToEndWorkout;
		if (ask && !(await ask())) return;
		// The screen first: a save that answers with no page drawing the ride
		// lands as a toast instead of on its card (#1544).
		await goto(rideDock.screen);
		// A leave guard (an editor's unsaved changes) can keep the rider where
		// they were: the ride then rides on.
		if (!theRide.live || !drawsTheRide(page.url.pathname)) return;
		if (road) await road.end();
		else if (ramp) ramp.stop();
		else session?.stop();
	},
};
