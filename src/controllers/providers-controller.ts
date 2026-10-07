import { managedProviders } from "../admin/settings.js";

/**
 * Kept only for backward API compatibility. Discovery is open-web and no provider
 * allow-list is configured anymore.
 */
export async function providersController() {
  const providers = await managedProviders();
  return {
    mode: "open_web_with_managed_sources",
    providers,
    message: "Search remains open-web; managed providers are centrally configured discovery hints.",
  };
}
