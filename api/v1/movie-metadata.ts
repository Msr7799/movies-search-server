import type { VercelRequest } from "@vercel/node";
import { endpoint } from "../../src/http/handler.js";
import { AppError } from "../../src/http/errors.js";
import { movieMetadata } from "../../src/services/movie-metadata.js";

export default endpoint(["GET"], async (request: VercelRequest) => {
  const title = typeof request.query.title === "string" ? request.query.title.trim() : "";
  if (title.length < 2 || title.length > 180) throw new AppError(400, "INVALID_TITLE", "اسم الفيلم غير صالح.");
  return { metadata: await movieMetadata(title) };
});
