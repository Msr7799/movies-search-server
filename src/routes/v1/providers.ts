import { providersController } from "../../controllers/providers-controller.js";
import { endpoint } from "../../http/handler.js";

export default endpoint(["GET"], providersController);
