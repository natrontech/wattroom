/**
 * Minimal GATT fake: enough of a device/service/characteristic for FtmsTrainer to
 * attach to, plus a hand on how the trainer answers each control-point write —
 * acknowledge it, fail the write itself, or never answer at all.
 */
export class FakeCharacteristic extends EventTarget {
	value?: DataView;
	notifying = false;
	/** Every frame that actually reached the device, in order. */
	writes: Uint8Array[] = [];
	/** How the trainer answers a write. Default: immediate success indication. */
	answer: (frame: Uint8Array) => 'ack' | 'fail' | 'silent' = () => 'ack';

	async startNotifications(): Promise<FakeCharacteristic> {
		this.notifying = true;
		return this;
	}

	async readValue(): Promise<DataView> {
		return this.value!;
	}

	async writeValueWithResponse(bytes: ArrayBuffer): Promise<void> {
		const frame = new Uint8Array(bytes);
		this.writes.push(frame);
		const answer = this.answer(frame);
		if (answer === 'fail') throw new Error('GATT operation failed');
		if (answer === 'ack') this.indicate(frame[0]);
	}

	/** The 0x80 response frame: response opcode, request opcode, result. */
	indicate(op: number, result = 0x01): void {
		this.notify(Uint8Array.of(0x80, op, result));
	}

	notify(bytes: Uint8Array): void {
		this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.dispatchEvent(new Event('characteristicvaluechanged'));
	}
}

export class FakeDevice extends EventTarget {
	name = 'Fake Kickr';
	/** GATT connect count — the reattach loop's tell. */
	connects = 0;
	bikeData = new FakeCharacteristic();
	control = new FakeCharacteristic();
	machineStatus = new FakeCharacteristic();
	powerRange = new FakeCharacteristic();

	constructor() {
		super();
		// min 0 W, max 2000 W, 1 W increment — the #43 hardware dump.
		this.powerRange.value = new DataView(
			Uint8Array.of(0x00, 0x00, 0xd0, 0x07, 0x01, 0x00).buffer,
		);
	}

	// The browser hands back the same characteristic objects on every reattach,
	// which is what makes a leaked listener leak.
	#service = {
		getCharacteristic: async (uuid: number) => {
			const found = {
				0x2ad2: this.bikeData,
				0x2ad9: this.control,
				0x2ada: this.machineStatus,
				0x2ad8: this.powerRange,
			}[uuid];
			if (!found) throw new Error(`no characteristic 0x${uuid.toString(16)}`);
			return found;
		},
	};

	gatt = {
		connect: async () => {
			this.connects++;
			return { getPrimaryService: async () => this.#service };
		},
		disconnect: () => this.drop(),
	};

	/** What the browser does when the link goes away. */
	drop(): void {
		this.dispatchEvent(new Event('gattserverdisconnected'));
	}
}
