import type { VercelRequest } from "@vercel/node";
import { endpoint } from "../../http/handler.js";
import { AppError } from "../../http/errors.js";
import { movieMetadata } from "../../services/movie-metadata.js";

export default endpoint(["GET"], async (request: VercelRequest) => {
  const title = typeof request.query.title === "string" ? request.query.title.trim() : "";
  if (title.length < 2 || title.length > 180) throw new AppError(400, "INVALID_TITLE", "اسم الفيلم غير صالح.");
  return { metadata: await movieMetadata(title) };
});
