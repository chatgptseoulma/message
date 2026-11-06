import { checkPassword, send, sessionCookie } from "../lib/common.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST만 허용됩니다." });
  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { body = {}; }
  if (checkPassword(body?.password)) {
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie() });
  }
  await new Promise(r => setTimeout(r, 1000)); // 무차별 대입 속도 늦추기
  return send(res, 401, { error: "비밀번호가 올바르지 않습니다." });
}
