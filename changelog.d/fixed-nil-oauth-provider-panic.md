- A request to the sign-in start or callback of the dev or synthetic
  provider now gets a 404 instead of crashing the handler and writing a
  stack dump to the log. Any handler crash is now logged at ERROR, where
  alerts can see it.
