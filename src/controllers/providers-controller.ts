/**
 * Kept only for backward API compatibility. Discovery is open-web and no provider
 * allow-list is configured anymore.
 */
export function providersController() {
  return {
    mode: "open_web",
    providers: [],
    message: "Search is not restricted to a configured provider list.",
  };
}
