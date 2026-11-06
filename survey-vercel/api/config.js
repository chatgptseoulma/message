import { OPTIONS, MAX_AREAS, send } from "../lib/common.js";

export default function handler(req, res) {
  send(res, 200, { ...OPTIONS, max_areas: MAX_AREAS });
}
