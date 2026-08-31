/**
 * The value format WhenPicker speaks: datetime-local, YYYY-MM-DDTHH:MM, in
 * the rider's own zone. Three surfaces plan or move a session (the room's
 * picker, the room's card, /sessions) and every one of them was doing the
 * timezone-offset shuffle by hand.
 */
export function toLocalInput(when: Date): string {
	const t = new Date(when);
	// toISOString is UTC; shifting by the offset first makes the slice read
	// as local wall-clock, which is what the input expects.
	t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
	return t.toISOString().slice(0, 16);
}

/** What a plan defaults to: the next full hour. */
export function nextHourInput(): string {
	const t = new Date(Date.now() + 60 * 60 * 1000);
	t.setMinutes(0, 0, 0);
	return toLocalInput(t);
}
