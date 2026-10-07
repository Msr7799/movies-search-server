import { healthController } from "../../controllers/health-controller.js";
import { endpoint } from "../../http/handler.js";

export default endpoint(["GET"], healthController);
