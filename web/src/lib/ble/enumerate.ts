/**
 * GATT enumeration for hardware sessions (#10) — specifically the Kickr v2 question:
 * RESEARCH.md §9 presumes the 2016 unit is WCPS-only, but that is inference from
 * firmware notes. A dump settles it.
 *
 * Hard constraint: Web Bluetooth only exposes services declared up front, so an
 * undeclared service is invisible no matter what the device advertises. KNOWN below
 * is therefore both the decoder ring and the limit of what can be discovered.
 */
const KNOWN: Record<string, string> = {
	'00001800-0000-1000-8000-00805f9b34fb': 'Generic Access',
	'00001801-0000-1000-8000-00805f9b34fb': 'Generic Attribute',
	'0000180a-0000-1000-8000-00805f9b34fb': 'Device Information',
	'0000180d-0000-1000-8000-00805f9b34fb': 'Heart Rate',
	'0000180f-0000-1000-8000-00805f9b34fb': 'Battery',
	'00001816-0000-1000-8000-00805f9b34fb': 'Cycling Speed and Cadence',
	'00001818-0000-1000-8000-00805f9b34fb': 'Cycling Power',
	'00001826-0000-1000-8000-00805f9b34fb': 'Fitness Machine (FTMS)',
	'00002a63-0000-1000-8000-00805f9b34fb': 'Cycling Power Measurement',
	'00002ad2-0000-1000-8000-00805f9b34fb': 'Indoor Bike Data',
	'00002ad9-0000-1000-8000-00805f9b34fb': 'Fitness Machine Control Point',
	'00002ada-0000-1000-8000-00805f9b34fb': 'Fitness Machine Status',
	// RESEARCH.md §9: Wahoo's proprietary control characteristic, hung off 0x1818.
	'a026e005-0a7d-4ab3-97fa-f1500f9feb8b': 'Wahoo WCPS control point',
	'6e40fec1-b5a3-f393-e0a9-e50e24dcca9e': 'Tacx FE-C over BLE',
	'00000001-19ca-4651-86e5-fa29dcdd09d1': 'Zwift accessory (ZAP)',
};

/** Everything worth asking for. Anything omitted here cannot be seen at all. */
export const PROBE_SERVICES: BluetoothServiceUUID[] = [
	0x1800,
	0x1801,
	0x180a,
	0x180d,
	0x180f,
	0x1816,
	0x1818,
	0x1826,
	'6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
	'00000001-19ca-4651-86e5-fa29dcdd09d1',
];

export interface GattCharacteristic {
	uuid: string;
	name?: string;
	properties: string[];
	value?: string;
	text?: string;
}

export interface GattService {
	uuid: string;
	name?: string;
	characteristics: GattCharacteristic[];
	error?: string;
}

export interface GattDump {
	device: string;
	services: GattService[];
	hasFtms: boolean;
	hasWcps: boolean;
}

const label = (uuid: string) => KNOWN[uuid.toLowerCase()];

function propertyList(p: BluetoothCharacteristicProperties): string[] {
	const names: [keyof BluetoothCharacteristicProperties, string][] = [
		['read', 'read'],
		['write', 'write'],
		['writeWithoutResponse', 'writeNoResp'],
		['notify', 'notify'],
		['indicate', 'indicate'],
		['broadcast', 'broadcast'],
	];
	return names.filter(([key]) => p[key]).map(([, name]) => name);
}

const hex = (view: DataView) =>
	[...new Uint8Array(view.buffer)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join(' ');

/** Device Information strings are the useful readable ones — firmware revision especially. */
function asText(view: DataView): string | undefined {
	const bytes = new Uint8Array(view.buffer);
	if (!bytes.length || bytes.some((b) => b !== 0 && (b < 0x20 || b > 0x7e)))
		return undefined;
	return new TextDecoder().decode(bytes).replace(/\0+$/, '');
}

export async function enumerateGatt(
	onStep?: (text: string) => void,
): Promise<GattDump> {
	if (!navigator.bluetooth)
		throw new Error('This browser has no Web Bluetooth');

	// No service filter: the whole point is to see what an unknown unit exposes.
	const device = await navigator.bluetooth.requestDevice({
		acceptAllDevices: true,
		optionalServices: PROBE_SERVICES,
	});
	onStep?.(`selected ${device.name ?? 'unnamed device'}`);

	const server = await device.gatt!.connect();
	onStep?.('connected, enumerating services');

	const services = await server.getPrimaryServices();
	const dump: GattDump = {
		device: device.name ?? 'unnamed device',
		services: [],
		hasFtms: false,
		hasWcps: false,
	};

	for (const service of services) {
		const entry: GattService = {
			uuid: service.uuid,
			name: label(service.uuid),
			characteristics: [],
		};
		if (service.uuid.startsWith('00001826')) dump.hasFtms = true;

		try {
			for (const char of await service.getCharacteristics()) {
				const props = propertyList(char.properties);
				const item: GattCharacteristic = {
					uuid: char.uuid,
					name: label(char.uuid),
					properties: props,
				};
				if (char.uuid.toLowerCase().startsWith('a026e005')) dump.hasWcps = true;

				// Reading is best-effort: some characteristics refuse, and that is fine.
				if (props.includes('read')) {
					try {
						const value = await char.readValue();
						item.value = hex(value);
						item.text = asText(value);
					} catch (error) {
						item.value = `unreadable (${error instanceof Error ? error.message : error})`;
					}
				}
				entry.characteristics.push(item);
			}
		} catch (error) {
			entry.error = error instanceof Error ? error.message : String(error);
		}

		dump.services.push(entry);
		onStep?.(
			`${entry.name ?? entry.uuid}: ${entry.characteristics.length} characteristics`,
		);
	}

	server.disconnect();
	return dump;
}
