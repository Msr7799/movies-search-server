import { getProviders } from "../domain/providers.js";

export function providersController() {
  return {
    policy: "legal_and_official_sources_only",
    providers: getProviders().map((provider, index) => ({ priority: index + 1, ...provider })),
  };
}
