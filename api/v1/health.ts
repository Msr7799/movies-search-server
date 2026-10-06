import { healthController } from "../../src/controllers/health-controller.js";
import { endpoint } from "../../src/http/handler.js";

export default endpoint(["GET"], healthController);
