import { db, send, validate, Invalid } from "../lib/common.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST만 허용됩니다." });
  let r;
  try {
    r = validate(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
  } catch (e) {
    if (e instanceof Invalid || e instanceof SyntaxError) return send(res, 400, { error: e.message });
    throw e;
  }
  try {
    const { data: existing, error: e1 } = await db().from("responses").select("emp_no").eq("emp_no", r.emp_no).maybeSingle();
    if (e1) throw e1;
    const now = new Date().toISOString();
    const row = { ...r, updated_at: now, ...(existing ? {} : { created_at: now }) };
    const { error: e2 } = await db().from("responses").upsert(row, { onConflict: "emp_no" });
    if (e2) throw e2;
    return send(res, existing ? 200 : 201, { ok: true, updated: Boolean(existing) });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
  }
}
