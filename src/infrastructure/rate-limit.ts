import { createHash } from "node:crypto";
import { AppError } from "../http/errors.js";
import { incrementWindow } from "./store.js";

export async function enforceRateLimit(
  scope: string,
  identity: string,
  limit: number,
  windowSeconds: number,
) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const safeIdentity = createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 24);
  const count = await incrementWindow(
    `rl:${scope}:${bucket}:${safeIdentity}`,
    windowSeconds + 5,
  );
  if (count > limit) {
    throw new AppError(
      429,
      "RATE_LIMITED",
      "طلبات كثيرة جدًا. حاول لاحقًا.",
      windowSeconds,
    );
  }
}
