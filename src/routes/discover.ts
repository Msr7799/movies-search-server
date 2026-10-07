import { searchController } from "../controllers/search-controller.js";
import { endpoint } from "../http/handler.js";

// Compatibility route for any-movie-web. Prefer /api/v1/search in new clients.
export default endpoint(["POST"], searchController);
