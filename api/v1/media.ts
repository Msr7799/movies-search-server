import { mediaController } from "../../src/controllers/media-controller.js";
import { endpoint } from "../../src/http/handler.js";

export default endpoint(["POST"], mediaController);
