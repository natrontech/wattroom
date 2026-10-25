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

	/** Write without response (OBC's App Information and haptics): recorded, never answered. */
	async writeValueWithoutResponse(bytes: Uint8Array): Promise<void> {
		this.writes.push(Uint8Array.from(bytes));
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
	/** Every primary service asked for, in order. */
	services: number[] = [];
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
			return {
				getPrimaryService: async (uuid: number) => {
					this.services.push(uuid);
					return this.#service;
				},
			};
		},
		disconnect: () => this.drop(),
	};

	/** What the browser does when the link goes away. */
	drop(): void {
		this.dispatchEvent(new Event('gattserverdisconnected'));
	}
}

/**
 * An OpenBikeControl controller (#3335): its one service, Button State to
 * notify on, and Haptic and App Information to write to. `haptics: false`
 * is a controller without a motor, which has no haptic characteristic.
 */
export class FakeObcDevice extends EventTarget {
	name = 'Fake OBC';
	connects = 0;
	buttonState = new FakeCharacteristic();
	haptic = new FakeCharacteristic();
	appInfo = new FakeCharacteristic();

	constructor(readonly haptics = true) {
		super();
	}

	#service = {
		getCharacteristic: async (uuid: string) => {
			const found = {
				'd273f681-d548-419d-b9d1-fa0472345229': this.buttonState,
				'd273f682-d548-419d-b9d1-fa0472345229': this.haptics
					? this.haptic
					: undefined,
				'd273f683-d548-419d-b9d1-fa0472345229': this.appInfo,
			}[uuid];
			if (!found) throw new Error(`no characteristic ${uuid}`);
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

	/** Buttons as the controller sends them: one Button State notification. */
	press(...bytes: number[]): void {
		this.buttonState.notify(Uint8Array.of(...bytes));
	}

	drop(): void {
		this.dispatchEvent(new Event('gattserverdisconnected'));
	}
}
