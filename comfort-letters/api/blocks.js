// 차단 목록
//  GET              : 내가 차단한 사람들 [{id, nickname, emoji, created_at}]
//  POST {user_id}   : 차단 (서로의 하소연 방과 메시지가 안 보이게 됨)
//  DELETE ?user_id= : 차단 풀기
import { db, send, handle, body, isUuid, currentUser, Invalid } from "../lib/common.js";

export default handle(async (req, res) => {
  const user = await currentUser(req);

  if (req.method === "GET") {
    const { data, error } = await db().from("cb_blocks").select("blocked_id, created_at").eq("blocker_id", user.id).order("created_at", { ascending: false });
    if (error) throw error;
    const ids = data.map(b => b.blocked_id);
    const { data: users, error: e2 } = ids.length ? await db().from("cb_users").select("id, nickname, emoji").in("id", ids) : { data: [] };
    if (e2) throw e2;
    const who = Object.fromEntries(users.map(u => [u.id, u]));
    return send(res, 200, data.filter(b => who[b.blocked_id]).map(b => ({
      id: b.blocked_id, nickname: who[b.blocked_id].nickname, emoji: who[b.blocked_id].emoji ?? "", created_at: b.created_at,
    })));
  }

  if (req.method === "POST") {
    const target = body(req).user_id;
    if (!isUuid(target)) throw new Invalid("차단할 사람을 찾을 수 없어요.", 404);
    if (target === user.id) throw new Invalid("자기 자신은 차단할 수 없어요.");
    const { data: u, error: e1 } = await db().from("cb_users").select("id").eq("id", target).maybeSingle();
    if (e1) throw e1;
    if (!u) throw new Invalid("차단할 사람을 찾을 수 없어요.", 404);
    const { error } = await db().from("cb_blocks").upsert({ blocker_id: user.id, blocked_id: target }, { onConflict: "blocker_id,blocked_id" });
    if (error) throw error;
    return send(res, 200, { ok: true });
  }

  if (req.method === "DELETE") {
    const target = String(req.query.user_id ?? "");
    if (!isUuid(target)) throw new Invalid("차단한 사람을 찾을 수 없어요.", 404);
    const { error } = await db().from("cb_blocks").delete().eq("blocker_id", user.id).eq("blocked_id", target);
    if (error) throw error;
    return send(res, 200, { ok: true });
  }
  send(res, 405, { error: "허용되지 않은 요청이에요." });
});
