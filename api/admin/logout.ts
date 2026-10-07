import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminCookie } from "../../src/admin/auth.js";

export default function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ error: "method_not_allowed" });
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Set-Cookie", adminCookie("", true));
  return response.status(200).json({ ok: true });
}
