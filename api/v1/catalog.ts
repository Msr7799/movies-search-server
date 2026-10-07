import { listCatalog } from "../../src/admin/catalog.js";
import { endpoint } from "../../src/http/handler.js";

export default endpoint(["GET"], async () => ({
  movies: await listCatalog(),
  updatedAt: new Date().toISOString(),
}));
