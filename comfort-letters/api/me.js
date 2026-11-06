// GET: 내 정보 / POST: 닉네임(+이모티콘)으로 시작(열쇠 발급) / PATCH: 닉네임·이모티콘 변경 / DELETE: 내 기록 지우기
import { db, send, handle, body, text, emoji, newToken, hashToken, currentUser, forgetUser, userHash, Invalid, stripInvisible,
  clientIp, ipHash, SIGNUPS_PER_IP_PER_DAY } from "../lib/common.js";
import { recomputeLast } from "../lib/rooms.js";

async function profile(user) {
  const { data: c, error } = await db().from("cb_comforters").select("intro, active").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  return { id: user.id, nickname: user.nickname, emoji: user.emoji ?? "", comforter: c ? { intro: c.intro, active: c.active } : null };
}

export default handle(async (req, res) => {
  if (req.method === "GET") {
    return send(res, 200, await profile(await currentUser(req)));
  }
  if (req.method === "POST") {
    const b = body(req);
    const nickname = text(stripInvisible(b.nickname), { min: 1, max: 20, label: "닉네임" });
    const em = emoji(b.emoji) ?? "";
    // 같은 접속 주소에서 하루 계정 생성 수 제한 (보안점검 V-02). IP 는 해시로만, 2일 지난 기록은 지움
    const ip = clientIp(req);
    const ih = ip ? ipHash(ip) : null;
    if (ih) {
      const now = Date.now();
      const [{ count, error: ce }, { error: pe }] = await Promise.all([
        db().from("cb_signup_log").select("id", { count: "exact", head: true }).eq("ip_hash", ih).gte("created_at", new Date(now - 86_400_000).toISOString()),
        db().from("cb_signup_log").delete().lt("created_at", new Date(now - 2 * 86_400_000).toISOString()),
      ]);
      if (ce) throw ce;
      if (pe) throw pe;
      if (count >= SIGNUPS_PER_IP_PER_DAY) throw new Invalid("이 곳에서는 오늘 닉네임을 더 만들 수 없어요. 내일 다시 해 주세요.", 429);
    }
    const token = newToken();
    const { data, error } = await db().from("cb_users").insert({ token_hash: hashToken(token), nickname, emoji: em }).select("id, nickname, emoji").single();
    if (error) throw error;
    if (ih) {
      const { error: le } = await db().from("cb_signup_log").insert({ ip_hash: ih });
      if (le) throw le;
    }
    return send(res, 201, { token, ...(await profile(data)) });
  }
  if (req.method === "PATCH") {
    const user = await currentUser(req);
    const b = body(req);
    const patch = {};
    if (b.nickname !== undefined) patch.nickname = text(stripInvisible(b.nickname), { min: 1, max: 20, label: "닉네임" });
    if (b.emoji !== undefined) patch.emoji = emoji(b.emoji);
    if (!Object.keys(patch).length) throw new Invalid("닉네임을(를) 적어 주세요.");
    const { error } = await db().from("cb_users").update(patch).eq("id", user.id);
    if (error) throw error;
    forgetUser(userHash(req));
    return send(res, 200, await profile({ ...user, ...patch }));
  }
  if (req.method === "DELETE") {
    // 내 기록 지우기: 닉네임, 위로하기 등록, 내가 주고받은 편지 전부 (DB의 cascade로 함께 삭제)
    const user = await currentUser(req);
    // 내가 마지막으로 쓴 남의 방: 지운 뒤 목록 미리보기에 내 글이 남지 않게 다시 계산 (보안점검 V-03)
    const { data: touched, error: e0 } = await db().from("cb_threads").select("id").eq("last_author", user.id).neq("seeker_id", user.id);
    if (e0) throw e0;
    const { error } = await db().from("cb_users").delete().eq("id", user.id);
    if (error) throw error;
    forgetUser(userHash(req));
    await recomputeLast(touched.map(t => t.id));
    return send(res, 200, { ok: true });
  }
  send(res, 405, { error: "허용되지 않은 요청이에요." });
});
