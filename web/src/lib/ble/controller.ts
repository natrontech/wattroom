/**
 * The boundary to a handlebar controller (#3335), beside `Sensor` and
 * `Trainer` and for their reason: `navigator.bluetooth` is called only here.
 * A controller is neither: it is written to (App Information, haptics) and
 * read for presses, not for measurements. `BleSensorSpec` takes 16-bit UUIDs
 * and cannot write, so it is not reused.
 *
 * It speaks OpenBikeControl only, never a vendor protocol (ADR-0084): with
 * BikeControl on a phone acting as the controller, a Zwift Click, a Di2 or a
 * gamepad reaches WattRoom as OBC, and this repo holds no Zwift or SRAM code.
 */
import { hwlog } from './hwlog';
import {
	OBC,
	WATTROOM_APP_INFO,
	createObcButtons,
	decodeObc,
	encodeHaptic,
	type ObcAction,
	type ObcEdge,
	type ObcFeel,
} from './obc';
import { createReattach } from './reattach';
import type { SensorStatus } from './sensor';

export interface Controller {
	readonly name: string;
	readonly status: SensorStatus;
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	/** A button's edge; a lost link lets every held one go as `drop`. Returns unsubscribe. */
	onAction(cb: (action: ObcAction, edge: ObcEdge) => void): () => void;
	onStatus(cb: (s: SensorStatus) => void): () => void;
	/** The controller's own vibration, where it has one (ADR-0084 rule 2). */
	feel(feel: ObcFeel): void;
}

export function createObcController(): Controller {
	let device: BluetoothDevice | undefined;
	let status: SensorStatus = 'disconnected';
	let name = 'Shifter';
	/** Set on rider-initiated disconnect, so the retry loop stands down. */
	let closed = false;
	let attachment: AbortController | undefined;
	let haptic: BluetoothRemoteGATTCharacteristic | undefined;
	const actionCbs = new Set<(action: ObcAction, edge: ObcEdge) => void>();
	const statusCbs = new Set<(s: SensorStatus) => void>();
	const buttons = createObcButtons((action, edge) => {
		for (const cb of actionCbs) cb(action, edge);
	});

	function setStatus(next: SensorStatus) {
		status = next;
		for (const cb of statusCbs) cb(next);
	}

	/** An optional characteristic: a controller without haptics still shifts. */
	async function optional(
		service: BluetoothRemoteGATTService,
		uuid: string,
	): Promise<BluetoothRemoteGATTCharacteristic | undefined> {
		try {
			return await service.getCharacteristic(uuid);
		} catch {
			return undefined;
		}
	}

	async function attach(): Promise<void> {
		attachment?.abort();
		const { signal } = (attachment = new AbortController());
		const server = await device!.gatt!.connect();
		if (abandoned(signal)) return;
		const service = await server.getPrimaryService(OBC.service);
		const state = await service.getCharacteristic(OBC.buttonState);
		haptic = await optional(service, OBC.haptic);
		// The buttons WattRoom answers, so the controller sends those
		// (BLE.md: it is emptied on every disconnect, so every attach).
		const info = await optional(service, OBC.appInfo);
		await info
			?.writeValueWithoutResponse(WATTROOM_APP_INFO)
			.catch((cause: unknown) =>
				hwlog('error', { text: `obc app info: ${String(cause)}` }),
			);
		await state.startNotifications();
		state.addEventListener(
			'characteristicvaluechanged',
			(event) => {
				const view = (event.target as BluetoothRemoteGATTCharacteristic).value;
				if (!view) return;
				const bytes = new Uint8Array(
					view.buffer,
					view.byteOffset,
					view.byteLength,
				);
				buttons.take(decodeObc(bytes));
			},
			{ signal },
		);
		if (abandoned(signal)) return;
		retry.reset();
		setStatus('connected');
	}

	function abandoned(signal: AbortSignal): boolean {
		if (!closed && !signal.aborted) return false;
		device?.gatt?.disconnect();
		return true;
	}

	const retry = createReattach(
		() => attach(),
		() => closed || status === 'connected',
	);

	return {
		get name() {
			return name;
		},
		get status() {
			return status;
		},

		async connect() {
			if (!navigator.bluetooth)
				throw new Error('This browser has no Web Bluetooth');
			setStatus('connecting');
			closed = false;
			try {
				device = await navigator.bluetooth.requestDevice({
					filters: [{ services: [OBC.service] }],
				});
				name = device.name ?? name;
				device.addEventListener('gattserverdisconnected', () => {
					haptic = undefined;
					buttons.drop();
					if (closed) return setStatus('disconnected');
					setStatus('connecting');
					retry.schedule();
				});
				await attach();
			} catch (cause) {
				setStatus('disconnected');
				throw cause;
			}
		},

		async disconnect() {
			closed = true;
			buttons.drop();
			device?.gatt?.disconnect();
			attachment?.abort();
			setStatus('disconnected');
		},

		onAction(cb) {
			actionCbs.add(cb);
			return () => actionCbs.delete(cb);
		},
		onStatus(cb) {
			statusCbs.add(cb);
			return () => statusCbs.delete(cb);
		},

		feel(feel) {
			void haptic
				?.writeValueWithoutResponse(encodeHaptic(feel))
				.catch(() => undefined);
		},
	};
}
