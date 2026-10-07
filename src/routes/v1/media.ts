import { mediaController } from "../../controllers/media-controller.js";
import { endpoint } from "../../http/handler.js";

export default endpoint(["POST"], mediaController);
