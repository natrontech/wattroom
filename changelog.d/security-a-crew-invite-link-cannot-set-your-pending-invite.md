- Opening a crew's invite link no longer writes to your account just by being
  opened. Reading the door at `/c/{code}` used to record that code as your
  pending invite, and a read carries no cross-site protection — so any page
  could link a signed-in rider at it and decide which crew a brand-new account
  is pointed at after sign-up. The invite is now remembered by a separate call
  the crew page makes, which a foreign page cannot make for you.
