import { suggestionsController } from "../../controllers/suggestions-controller.js";
import { endpoint } from "../../http/handler.js";

export default endpoint(["POST"], suggestionsController);
