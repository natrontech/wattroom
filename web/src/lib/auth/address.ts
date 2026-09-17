/**
 * What an email address is for, in one sentence (#2181).
 *
 * ADR-0029 decided it — getting back in, and the planned-session mail that
 * predates the gate (#117) — and three surfaces each wrote their own version:
 * the sign-in page said "only used to get you back in", the gate said
 * "Nothing else uses it", and the profile pointed at a Notifications switch
 * that mails you about four things. Two of the three were wrong for any rider
 * who turns that switch on, which is the one the promise was made to.
 */
export const EMAIL_IS_FOR =
	'It is how you get back into this account if you lose the way you sign in, and — if you switch that on — how a planned session reaches you. It is never shown to anyone.';
