import { formatClock } from '$lib/format';
import type { Fault } from '$lib/channel/types';

/** What a fault banner says: a title, the line under it, and the button's word. */
export interface FaultCopy {
	title: string;
	detail: string;
	action?: string;
}

// What went wrong, why it matters, what happens next — never "something went wrong".
// bufferedSeconds is how much riding this device holds for the channel; absent
// when there is no ride, so a dropped channel promises nothing stored (#2855).
export function faultCopy(fault: Fault, bufferedSeconds?: number): FaultCopy {
	if (fault.kind === 'trainer') {
		if (fault.state === 'no-power')
			return {
				title: 'Trainer is connected but sends no power',
				detail:
					'It reports over Bluetooth — cadence or speed — but never watts, so nothing here can score you. Pair a power meter as a sensor, or a trainer that measures power.',
				// The button opens the chooser, which is what this copy asks
				// for — "Reconnect" named the one thing that will not help
				// here, since the device is connected (#2161).
				action: 'Pair another device',
			};
		if (fault.state === 'silent')
			return {
				title: 'Trainer is connected but sending nothing',
				detail:
					'No data has arrived over Bluetooth. Spin the cranks to wake it — and close anything else holding the trainer (Zwift, the Wahoo app, another tab), since it only accepts one connection.',
			};
		return fault.state === 'reconnecting'
			? {
					title: 'Trainer disconnected',
					detail:
						'Reconnecting over Bluetooth. Keep pedalling — your ride is still recording.',
				}
			: {
					title: "Trainer didn't come back",
					detail:
						'Bluetooth dropped and three retries failed. Wake the trainer (spin the cranks) and reconnect.',
				};
	}
	if (fault.kind === 'voice') {
		return fault.state === 'reconnecting'
			? {
					title: 'Voice dropped',
					detail:
						'Reconnecting the call — the others may not hear you right now. Your ride and metrics are unaffected.',
				}
			: {
					title: "Voice didn't come back",
					detail:
						'The call could not reconnect. Your ride is unaffected — rejoin voice when you are ready.',
				};
	}
	if (fault.kind === 'mic') {
		return {
			title: 'Your microphone stopped',
			detail:
				'The browser lost the microphone — a headset unplugged, Bluetooth switching to its phone profile, or another app taking it. The call hears nothing from you; your ride is unaffected. Plug it back in and reconnect.',
		};
	}
	const held =
		bufferedSeconds === undefined ? undefined : formatClock(bufferedSeconds);
	if (fault.state === 'offline')
		return {
			title: 'Your connection dropped',
			detail: `This device is offline, so the channel can't hear from you. It rejoins by itself the moment your network is back${held ? ` — ${held} of riding is stored here until then` : ''}.`,
		};
	return fault.state === 'reconnecting'
		? {
				title: 'Lost the channel',
				detail: held
					? `Reconnecting. ${held} of riding is buffered on this device and will be sent when you're back.`
					: 'Reconnecting — it rejoins by itself, nothing for you to do.',
			}
		: {
				title: "Still can't reach the channel",
				detail: `Retrying every 10 seconds — or reconnect now if your network just came back.${held ? ` Your ride is safe: ${held} is stored locally and uploads on reconnect.` : ''} Voice and the shared timeline are offline.`,
			};
}
