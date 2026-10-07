import type { VercelRequest } from "@vercel/node";
import { requireAdmin } from "../../src/admin/auth.js";
import { deleteCatalogMovie, importCatalog, listCatalog } from "../../src/admin/catalog.js";
import { AppError } from "../../src/http/errors.js";
import { endpoint } from "../../src/http/handler.js";

async function controller(request: VercelRequest) {
  requireAdmin(request);
  if (request.method === "GET") return { movies: await listCatalog() };
  if (request.method === "DELETE") {
    const id = typeof request.query.id === "string" ? request.query.id : "";
    if (!/^[a-f0-9]{24}$/.test(id)) throw new AppError(400, "INVALID_ID", "معرّف الفيلم غير صالح.");
    return { deleted: await deleteCatalogMovie(id) };
  }
  const length = Number(request.headers["content-length"] ?? 0);
  if (length > 5_000_000) throw new AppError(413, "PAYLOAD_TOO_LARGE", "ملف JSON أكبر من 5MB.");
  const body = typeof request.body === "string" ? JSON.parse(request.body) as unknown : request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError(400, "INVALID_JSON", "ملف JSON غير صالح.");
  const wrapper = body as Record<string, unknown>;
  if (wrapper.rightsConfirmed !== true) throw new AppError(400, "RIGHTS_CONFIRMATION_REQUIRED", "يجب تأكيد امتلاك حق نشر المصادر.");
  return importCatalog(wrapper.catalog);
}

export default endpoint(["GET", "POST", "DELETE"], controller);
