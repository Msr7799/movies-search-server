import { adminConfigured, isAdminRequest } from "../../admin/auth.js";
import { mongoConfigured } from "../../infrastructure/mongodb.js";
import { endpoint } from "../../http/handler.js";

export default endpoint(["GET"], (request) => ({
  configured: adminConfigured(),
  authenticated: isAdminRequest(request),
  storageConfigured: mongoConfigured(),
}));
