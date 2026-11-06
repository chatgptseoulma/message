import { OPTIONS, isAdmin, fetchAll, db, send, kst } from "../lib/common.js";

function count(rows, key, choices, isArray = false) {
  const c = Object.fromEntries(choices.map(k => [k, 0]));
  for (const r of rows) for (const v of isArray ? r[key] : [r[key]]) c[v] = (c[v] ?? 0) + 1;
  return c;
}

export default async function handler(req, res) {
  if (!isAdmin(req)) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
  try {
    const dept = String(req.query.dept || ""), rank = String(req.query.rank || "");
    const rows = await fetchAll({ dept, rank });
    const { data: deptRows, error } = await db().from("responses").select("dept");
    if (error) throw error;
    const depts = [...new Set(deptRows.map(r => r.dept))].sort((a, b) => a.localeCompare(b, "ko"));

    const n = rows.length;
    const sats = rows.map(r => r.past_sat).filter(v => v > 0);
    const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 100) / 100 : null;
    send(res, 200, {
      count: n,
      avg_skill: avg(rows.map(r => r.skill)),
      avg_past_sat: avg(sats),
      past_none: rows.filter(r => r.past_sat === 0).length,
      areas: count(rows, "areas", OPTIONS.areas, true),
      methods: count(rows, "methods", OPTIONS.methods, true),
      time_slots: count(rows, "time_slot", OPTIONS.time_slots),
      durations: count(rows, "duration", OPTIONS.durations),
      barriers: count(rows, "barriers", OPTIONS.barriers, true),
      ranks: count(rows, "rank", OPTIONS.ranks),
      texts: rows
        .filter(r => r.priority_topic || r.area_other || r.barrier_other || r.comment)
        .map(r => ({ name: r.name, emp_no: r.emp_no, dept: r.dept, rank: r.rank, priority_topic: r.priority_topic,
                     area_other: r.area_other, barrier_other: r.barrier_other, comment: r.comment,
                     updated_at: kst(r.updated_at) })),
      depts,
    });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "결과를 불러오지 못했습니다." });
  }
}
