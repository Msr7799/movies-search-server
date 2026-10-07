import { searchController } from "../../controllers/search-controller.js";
import { endpoint } from "../../http/handler.js";

export default endpoint(["POST"], searchController);
