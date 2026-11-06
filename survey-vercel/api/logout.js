import { clearCookie } from "../lib/common.js";

export default function handler(req, res) {
  res.setHeader("Set-Cookie", clearCookie);
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, "/login");
}
