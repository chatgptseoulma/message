// GET: 위로해 주는 사람 목록 / POST: 위로해 주는 사람으로 등록·소개 수정·쉬기
import { db, send, handle, body, text, currentUser } from "../lib/common.js";

export default handle(async (req, res) => {
  if (req.method === "GET") {
    const me = await currentUser(req, { required: false });
    const { data, error } = await db()
      .from("cb_comforters")
      .select("user_id, intro, created_at, cb_users!inner(nickname)")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw error;

    // 답장 수(따뜻함 지표): 위로하는 사람이 쓴 메시지 수
    const ids = data.map(r => r.user_id);
    const counts = {};
    if (ids.length) {
      const { data: th, error: e2 } = await db().from("cb_threads").select("id, comforter_id").in("comforter_id", ids);
      if (e2) throw e2;
      for (const t of th) counts[t.comforter_id] = (counts[t.comforter_id] ?? 0) + 1;
    }
    return send(res, 200, data
      .filter(r => r.user_id !== me?.id)
      .map(r => ({ id: r.user_id, nickname: r.cb_users.nickname, intro: r.intro, letters: counts[r.user_id] ?? 0 })));
  }
  if (req.method === "POST") {
    const user = await currentUser(req);
    const b = body(req);
    const intro = text(b.intro, { max: 100, label: "소개" });
    const active = b.active !== false;
    const { error } = await db().from("cb_comforters").upsert({ user_id: user.id, intro, active }, { onConflict: "user_id" });
    if (error) throw error;
    return send(res, 200, { ok: true, comforter: { intro, active } });
  }
  send(res, 405, { error: "허용되지 않은 요청이에요." });
});
