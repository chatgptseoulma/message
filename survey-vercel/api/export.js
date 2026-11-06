import { isAdmin, fetchAll, send, kst } from "../lib/common.js";

// 엑셀이 수식으로 해석하지 않게 막고(CSV 인젝션 방지), CSV 규칙대로 따옴표 처리
function cell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default async function handler(req, res) {
  if (!isAdmin(req)) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
  try {
    const rows = (await fetchAll()).sort((a, b) => a.dept.localeCompare(b.dept, "ko") || a.emp_no.localeCompare(b.emp_no));
    const head = ["사번", "이름", "부서", "직급", "교육 분야", "기타 분야", "우선 교육 주제", "역량 자기평가",
      "선호 교육 방식", "선호 시간대", "적정 교육 시간", "지난 1년 교육 만족도",
      "어려운 점", "기타 어려운 점", "자유 의견", "최초 제출", "최종 수정"];
    const lines = [head.map(cell).join(",")];
    for (const r of rows) {
      const ps = r.past_sat == null ? "" : r.past_sat === 0 ? "받은 적 없음" : r.past_sat;
      lines.push([r.emp_no, r.name, r.dept, r.rank, r.areas.join(", "), r.area_other, r.priority_topic, r.skill,
        r.methods.join(", "), r.time_slot, r.duration, ps, r.barriers.join(", "), r.barrier_other, r.comment,
        kst(r.created_at), kst(r.updated_at)].map(cell).join(","));
    }
    const stamp = kst(new Date().toISOString()).replace(/[-: ]/g, "").slice(0, 12);
    send(res, 200, "﻿" + lines.join("\r\n") + "\r\n", {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="education_survey_${stamp}.csv"`,
    });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "CSV를 만들지 못했습니다." });
  }
}
