/**
 * The ride's controls while it draws: the riding surface asks for room
 * (`on`), the now bar gives it (`target`), and the surface renders its
 * controls in its own tree, so they keep its context, and moves them there.
 * Nothing is drawn on the ride itself.
 */
export const rideBar = $state<{ on: boolean; target: HTMLElement | null }>({
	on: false,
	target: null,
});

/** An attachment that moves its node into the now bar's room. */
export const intoBar = (target: HTMLElement) => (node: HTMLElement) => {
	target.append(node);
	return () => node.remove();
};
