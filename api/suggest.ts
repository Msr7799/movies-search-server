import { suggestionsController } from "../src/controllers/suggestions-controller.js";
import { endpoint } from "../src/http/handler.js";

// Compatibility route for any-movie-web. Prefer /api/v1/suggestions in new clients.
export default endpoint(["POST"], suggestionsController);
