import { endpoint } from "../src/http/handler.js";
import { openApiDocument } from "../src/openapi.js";

export default endpoint(["GET"], () => openApiDocument);
