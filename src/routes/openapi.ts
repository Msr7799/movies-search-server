import { endpoint } from "../http/handler.js";
import { openApiDocument } from "../openapi.js";

export default endpoint(["GET"], () => openApiDocument);
