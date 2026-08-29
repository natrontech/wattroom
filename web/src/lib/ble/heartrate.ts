import { createBleSensor, type ReadingFields, type Sensor } from './sensor';

/** Heart Rate Service and Heart Rate Measurement. */
const HR_SERVICE = 0x180d;
const HR_MEASUREMENT = 0x2a37;

/**
 * Parse Heart Rate Measurement (0x2A37).
 *
 * The trap from docs/RESEARCH.md §11: RR intervals are a **variable count** of
 * uint16s filling the rest of the packet — not one, not a fixed number. A parser
 * that reads a single RR value silently drops beats on any strap that batches them,
 * which is most of them when notifications are slower than the heart rate.
 *
 * The other trap is order: energy expended (bit 3) sits *between* the heart rate and
 * the RR block, so skipping it is not optional even though we do not use it.
 */
export function parseHeartRate(view: DataView): ReadingFields {
	const flags = view.getUint8(0);
	let offset = 1;

	// Bit 0 picks the width. Straps use uint8 until the rate exceeds 255, which is
	// never, but the format bit is authoritative and cheap to honour.
	let heartRate: number;
	if (flags & 0x01) {
		heartRate = view.getUint16(offset, true);
		offset += 2;
	} else {
		heartRate = view.getUint8(offset);
		offset += 1;
	}

	if (flags & 0x08) offset += 2; // energy expended, kJ

	const out: ReadingFields = { heartRate };

	if (flags & 0x10) {
		const rrIntervals: number[] = [];
		// Loop the remainder: however many fit, however many the strap sent.
		while (offset + 1 < view.byteLength) {
			// RR is in 1/1024 s; riders and HRV tools both speak milliseconds.
			rrIntervals.push(
				Math.round((view.getUint16(offset, true) * 1000) / 1024),
			);
			offset += 2;
		}
		if (rrIntervals.length > 0) out.rrIntervals = rrIntervals;
	}

	return out;
}

export function createHeartRateSensor(): Sensor {
	return createBleSensor({
		kind: 'heart-rate',
		service: HR_SERVICE,
		characteristic: HR_MEASUREMENT,
		defaultName: 'Heart rate strap',
		createParser: () => parseHeartRate,
	});
}
