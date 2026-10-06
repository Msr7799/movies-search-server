import { searchController } from "../../src/controllers/search-controller.js";
import { endpoint } from "../../src/http/handler.js";

export default endpoint(["POST"], searchController);
