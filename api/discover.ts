import { searchController } from "../src/controllers/search-controller.js";
import { endpoint } from "../src/http/handler.js";

// Compatibility route for any-movie-web. Prefer /api/v1/search in new clients.
export default endpoint(["POST"], searchController);
