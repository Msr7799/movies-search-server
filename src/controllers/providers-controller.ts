import { LEGAL_PROVIDERS, PLAYABLE_DOMAINS } from "../domain/providers.js";

export function providersController() {
  return {
    policy: "legal_and_official_sources_only",
    providers: LEGAL_PROVIDERS.map(([domain, name]) => ({ domain, name, inAppPlayback: PLAYABLE_DOMAINS.includes(domain) })),
  };
}
