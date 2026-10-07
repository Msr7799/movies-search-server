import { listPublicCatalog } from "../../admin/catalog.js";
import { endpoint } from "../../http/handler.js";

export default endpoint(["GET"], async () => ({
  movies: await listPublicCatalog(),
  updatedAt: new Date().toISOString(),
}));
