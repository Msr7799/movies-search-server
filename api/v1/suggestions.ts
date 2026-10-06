import { suggestionsController } from "../../src/controllers/suggestions-controller.js";
import { endpoint } from "../../src/http/handler.js";

export default endpoint(["POST"], suggestionsController);
