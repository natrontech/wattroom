import { describe, expect, it } from 'vitest';
import { type DeviceSeen, micBesideBluetooth } from './bluetooth-mic';

const dev = (
	kind: 'audioinput' | 'audiooutput',
	deviceId: string,
	label: string,
	groupId: string,
): DeviceSeen => ({ kind, deviceId, label, groupId });

// Chrome 141 on a MacBook, labels as Chromium writes them: the transport in
// brackets, a "default" entry first carrying the real device's groupId. The
// built-in mic and speakers share a groupId too (measured on Jan's Mac).
const builtInMic = dev(
	'audioinput',
	'mac-mic',
	'MacBook Pro Microphone (Built-in)',
	'g-mac',
);
const builtInOut = dev(
	'audiooutput',
	'mac-out',
	'MacBook Pro Speakers (Built-in)',
	'g-mac',
);
const airpodsMic = dev(
	'audioinput',
	'pods',
	'AirPods Pro (Bluetooth)',
	'g-pods',
);
const airpodsOut = dev(
	'audiooutput',
	'pods',
	'AirPods Pro (Bluetooth)',
	'g-pods',
);
const teams = dev(
	'audioinput',
	'teams',
	'Microsoft Teams Audio Device (Virtual)',
	'g-teams',
);
const usbMic = dev(
	'audioinput',
	'arctis',
	'Arctis Nova Pro Wireless (1038:12e0)',
	'g-arctis',
);
const usbOut = dev(
	'audiooutput',
	'arctis',
	'Arctis Nova Pro Wireless (1038:12e0)',
	'g-arctis',
);
const defaultOf = (d: DeviceSeen): DeviceSeen => ({
	...d,
	deviceId: 'default',
	label: `Default - ${d.label}`,
});

const cases: {
	name: string;
	list: DeviceSeen[];
	outId?: string;
	picks: string | null;
}[] = [
	{
		name: 'AirPods playing and the default mic: the MacBook mic',
		list: [
			defaultOf(airpodsMic),
			airpodsMic,
			builtInMic,
			defaultOf(airpodsOut),
			airpodsOut,
			builtInOut,
		],
		picks: 'mac-mic',
	},
	{
		name: 'AirPods playing, but the default mic is already the MacBook: left alone',
		list: [
			defaultOf(builtInMic),
			airpodsMic,
			builtInMic,
			defaultOf(airpodsOut),
			airpodsOut,
			builtInOut,
		],
		picks: null,
	},
	{
		name: 'voices to the speakers, while the system plays the AirPods',
		list: [
			defaultOf(airpodsMic),
			airpodsMic,
			builtInMic,
			defaultOf(airpodsOut),
			airpodsOut,
			builtInOut,
		],
		outId: 'mac-out',
		picks: 'mac-mic',
	},
	{
		name: 'the MacBook speakers playing, AirPods only as the mic: left alone',
		list: [
			defaultOf(airpodsMic),
			airpodsMic,
			builtInMic,
			defaultOf(builtInOut),
			airpodsOut,
			builtInOut,
		],
		picks: null,
	},
	{
		name: 'the rider sent voices to the AirPods themselves',
		list: [
			defaultOf(airpodsMic),
			airpodsMic,
			builtInMic,
			defaultOf(builtInOut),
			airpodsOut,
			builtInOut,
		],
		outId: 'pods',
		picks: 'mac-mic',
	},
	{
		name: 'a USB headset is no Bluetooth one: its own mic stays',
		list: [
			defaultOf(usbMic),
			usbMic,
			builtInMic,
			defaultOf(usbOut),
			usbOut,
			builtInOut,
		],
		picks: null,
	},
	{
		name: 'the MacBook alone: its shared groupId is no headset',
		list: [
			defaultOf(builtInMic),
			builtInMic,
			defaultOf(builtInOut),
			builtInOut,
		],
		picks: null,
	},
	{
		name: 'a virtual mic is never the computer’s own',
		list: [
			defaultOf(airpodsMic),
			airpodsMic,
			teams,
			defaultOf(airpodsOut),
			airpodsOut,
		],
		picks: null,
	},
	{
		name: 'a Mac mini with AirPods: no mic of its own to pick',
		list: [
			defaultOf(airpodsMic),
			airpodsMic,
			defaultOf(airpodsOut),
			airpodsOut,
		],
		picks: null,
	},
	{
		name: 'Firefox and Safari: bare names, no default entry, the first is the default',
		list: [
			dev('audioinput', 'p', 'AirPods', 'gp'),
			dev('audioinput', 'm', 'MacBook Pro Microphone', 'gm'),
			dev('audiooutput', 'po', 'AirPods', 'gp'),
			dev('audiooutput', 'mo', 'MacBook Pro Speakers', 'gm'),
		],
		picks: 'm',
	},
	{
		name: 'no output listed (Safari before 18.4): the headset mic is the evidence',
		list: [
			dev('audioinput', 'p', 'AirPods', 'gp'),
			dev('audioinput', 'm', 'MacBook Air Microphone', 'gm'),
		],
		picks: 'm',
	},
	{
		name: 'Windows: the hands-free endpoint and a laptop array',
		list: [
			dev(
				'audioinput',
				'default',
				'Default - Headset (AirPods Hands-Free AG Audio) (Bluetooth)',
				'gw',
			),
			dev(
				'audioinput',
				'hf',
				'Headset (AirPods Hands-Free AG Audio) (Bluetooth)',
				'gw',
			),
			dev(
				'audioinput',
				'arr',
				'Microphone Array (Intel® Smart Sound Technology)',
				'gl',
			),
			dev(
				'audiooutput',
				'default',
				'Default - Headphones (AirPods Stereo) (Bluetooth)',
				'gs',
			),
		],
		picks: 'arr',
	},
	{
		name: 'labels withheld before the mic is granted: nothing to judge',
		list: [dev('audioinput', '', '', ''), dev('audiooutput', '', '', '')],
		picks: null,
	},
	{ name: 'no devices at all', list: [], picks: null },
];

describe('micBesideBluetooth', () => {
	it.each(cases)('$name', ({ list, outId, picks }) => {
		expect(micBesideBluetooth(list, outId)?.deviceId ?? null).toBe(picks);
	});
});
