import { createCadenceTracker } from './revolutions';
import { createBleSensor, type ReadingFields, type Sensor } from './sensor';

/** Cycling Power Service and Cycling Power Measurement. */
const CPS_SERVICE = 0x1818;
const CPS_MEASUREMENT = 0x2a63;

/**
 * Parse Cycling Power Measurement (0x2A63).
 *
 * Thirteen optional fields in strict bit order, and every one of them has to be
 * skipped by exactly the right width even though we want only two. Get one wrong and
 * the fields after it decode as plausible garbage — a crank count read out of the
 * middle of a torque value still looks like a number.
 *
 * `crank` is returned raw rather than as rpm: cadence is a rate between packets, and
 * that state belongs to the sensor, not to a parse.
 */
export function parseCyclingPower(view: DataView): {
	watts: number;
	crank?: { revs: number; eventTime: number };
} {
	const flags = view.getUint16(0, true);
	// Signed: a power meter can report negative watts on the reverse stroke.
	const watts = view.getInt16(2, true);
	let offset = 4;

	if (flags & 0x0001) offset += 1; // pedal power balance
	// bit 1 is a reference flag, no payload
	if (flags & 0x0004) offset += 2; // accumulated torque
	// bit 3 is a source flag, no payload
	if (flags & 0x0010) offset += 6; // wheel revs: uint32 + uint16 event time

	let crank: { revs: number; eventTime: number } | undefined;
	if (flags & 0x0020) {
		crank = {
			revs: view.getUint16(offset, true),
			eventTime: view.getUint16(offset + 2, true),
		};
	}

	return crank ? { watts, crank } : { watts };
}

export function createPowerMeterSensor(): Sensor {
	return createBleSensor({
		kind: 'power-meter',
		service: CPS_SERVICE,
		characteristic: CPS_MEASUREMENT,
		defaultName: 'Power meter',
		createParser: () => {
			const cadenceFrom = createCadenceTracker();
			return (view): ReadingFields => {
				const { watts, crank } = parseCyclingPower(view);
				return crank ? { watts, cadence: cadenceFrom(crank) } : { watts };
			};
		},
	});
}
