import { providersController } from "../../src/controllers/providers-controller.js";
import { endpoint } from "../../src/http/handler.js";

export default endpoint(["GET"], providersController);
