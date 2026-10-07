import { adminConfigured, isAdminRequest } from "../../src/admin/auth.js";
import { mongoConfigured } from "../../src/infrastructure/mongodb.js";
import { endpoint } from "../../src/http/handler.js";

export default endpoint(["GET"], (request) => ({
  configured: adminConfigured(),
  authenticated: isAdminRequest(request),
  storageConfigured: mongoConfigured(),
}));
