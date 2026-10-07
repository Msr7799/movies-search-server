import type { VercelRequest } from "@vercel/node";
import { requireAdmin } from "../../admin/auth.js";
import { deleteCatalogMovie, importCatalog, listCatalog, updateCatalogMovie, type CatalogSource } from "../../admin/catalog.js";
import { AppError } from "../../http/errors.js";
import { endpoint } from "../../http/handler.js";

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
  if (request.method === "PATCH") {
    const id = typeof wrapper.id === "string" ? wrapper.id : "";
    if (!/^[a-f0-9]{24}$/.test(id)) throw new AppError(400, "INVALID_ID", "معرّف الفيلم غير صالح.");
    const categories = Array.isArray(wrapper.categories) ? wrapper.categories.filter((value): value is string => typeof value === "string") : undefined;
    const status = ["metadata_only", "draft", "published", "archived"].includes(String(wrapper.status)) ? String(wrapper.status) as "metadata_only" | "draft" | "published" | "archived" : undefined;
    let sources: CatalogSource[] | undefined;
    if (wrapper.sources !== undefined) {
      if (!Array.isArray(wrapper.sources) || wrapper.sources.length > 40) {
        throw new AppError(400, "INVALID_HLS_SOURCE", "قائمة روابط HLS غير صالحة.");
      }
      sources = wrapper.sources.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new AppError(400, "INVALID_HLS_SOURCE", "رابط HLS غير صالح.");
        }
        const source = item as Record<string, unknown>;
        if (typeof source.url !== "string" || typeof source.quality !== "string") {
          throw new AppError(400, "INVALID_HLS_SOURCE", "رابط HLS أو الجودة غير صالحة.");
        }
        return {
          url: source.url,
          quality: source.quality,
          ...(typeof source.id === "string" ? { id: source.id } : {}),
          ...(typeof source.resolution === "string" ? { resolution: source.resolution } : {}),
          ...(typeof source.bandwidth === "number" ? { bandwidth: source.bandwidth } : {}),
          ...(typeof source.master === "string" ? { master: source.master } : {}),
        };
      });
    }
    const updated = await updateCatalogMovie(id, {
      ...(typeof wrapper.title === "string" ? { title: wrapper.title } : {}),
      ...(typeof wrapper.description === "string" ? { description: wrapper.description } : {}),
      ...(typeof wrapper.sortOrder === "number" && Number.isFinite(wrapper.sortOrder) ? { sortOrder: wrapper.sortOrder } : {}),
      ...(categories ? { categories } : {}),
      ...(status ? { status } : {}),
      ...(sources !== undefined ? { sources } : {}),
    });
    if (!updated) throw new AppError(404, "MOVIE_NOT_FOUND", "الفيلم غير موجود.");
    return { movie: updated };
  }
  if (wrapper.rightsConfirmed !== true) throw new AppError(400, "RIGHTS_CONFIRMATION_REQUIRED", "يجب تأكيد امتلاك حق نشر المصادر.");
  return importCatalog(wrapper.catalog);
}

export default endpoint(["GET", "POST", "PATCH", "DELETE"], controller);
