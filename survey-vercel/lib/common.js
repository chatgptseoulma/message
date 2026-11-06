// 공통 모듈: 설문 선택지, 입력 검증, Supabase 클라이언트, 관리자 인증
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const OPTIONS = {
  ranks: ["사원", "주임·대리", "과장", "차장", "부장 이상"],
  areas: ["직무 전문성", "디지털·AI·데이터", "리더십·관리", "커뮤니케이션·협업",
          "문서·보고서 작성", "외국어", "자기계발·건강", "기타"],
  methods: ["오프라인 집합", "실시간 온라인", "녹화 강의(이러닝)", "사내 멘토링·스터디", "외부 위탁"],
  time_slots: ["근무시간 중", "점심시간", "퇴근 후", "주말"],
  durations: ["1시간 이하", "2~4시간", "하루", "2일 이상"],
  barriers: ["업무 부담", "시간 부족", "원하는 주제 없음", "교육 정보 부족", "기타"],
};
export const MAX_AREAS = 3;
// 결과·CSV를 비밀번호 없이 공개 (사용자 요청, 2026-11-05). false로 바꾸면 관리자 로그인이 다시 필요해짐.
export const RESULTS_PUBLIC = true;
const SESSION_HOURS = 8;

// ── Supabase (서버 전용 service role 키, 브라우저로는 절대 보내지 않음) ──
let _db;
export function db() {
  if (!_db) {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
    _db = createClient(url, key, { auth: { persistSession: false } });
  }
  return _db;
}

// ── 응답 헬퍼 ──
export function send(res, code, body, headers = {}) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (typeof body === "string") return res.status(code).send(body);
  return res.status(code).json(body);
}

// ── 입력 검증 ──
class Invalid extends Error {}
export { Invalid };

const text = (d, key, max, required, label) => {
  const v = String(d[key] ?? "").trim();
  if (required && !v) throw new Invalid(`${label}을(를) 입력해 주세요.`);
  if (v.length > max) throw new Invalid(`${label}은(는) ${max}자 이내로 입력해 주세요.`);
  return v;
};
const one = (d, key, choices, label) => {
  if (!choices.includes(d[key])) throw new Invalid(`${label}을(를) 선택해 주세요.`);
  return d[key];
};
const many = (d, key, choices, label, min = 0, max = 0) => {
  const v = d[key] ?? [];
  if (!Array.isArray(v) || v.some(x => !choices.includes(x))) throw new Invalid(`${label} 값이 올바르지 않습니다.`);
  const out = choices.filter(c => v.includes(c));
  if (out.length < min) throw new Invalid(`${label}을(를) ${min}개 이상 선택해 주세요.`);
  if (max && out.length > max) throw new Invalid(`${label}은(는) 최대 ${max}개까지 선택할 수 있습니다.`);
  return out;
};
const int = (d, key, lo, hi, label) => {
  const v = Number.parseInt(d[key], 10);
  if (!Number.isInteger(v)) throw new Invalid(`${label}을(를) 선택해 주세요.`);
  if (v < lo || v > hi) throw new Invalid(`${label}은(는) ${lo}~${hi} 사이여야 합니다.`);
  return v;
};

export function validate(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Invalid("잘못된 요청입니다.");
  const r = {
    name: text(d, "name", 30, true, "이름"),
    emp_no: text(d, "emp_no", 20, true, "사번"),
    dept: text(d, "dept", 50, true, "부서"),
    rank: one(d, "rank", OPTIONS.ranks, "직급"),
    areas: many(d, "areas", OPTIONS.areas, "교육 분야", 1, MAX_AREAS),
    area_other: text(d, "area_other", 100, false, "기타 교육 분야"),
    priority_topic: text(d, "priority_topic", 100, false, "우선 교육 주제"),
    skill: int(d, "skill", 1, 5, "직무 역량 자기평가"),
    methods: many(d, "methods", OPTIONS.methods, "선호 교육 방식", 1),
    time_slot: one(d, "time_slot", OPTIONS.time_slots, "선호 시간대"),
    duration: one(d, "duration", OPTIONS.durations, "적정 교육 시간"),
    barriers: many(d, "barriers", OPTIONS.barriers, "어려운 점"),
    barrier_other: text(d, "barrier_other", 100, false, "기타 어려운 점"),
    comment: text(d, "comment", 1000, false, "자유 의견"),
  };
  if (!/^[A-Za-z0-9-]{1,20}$/.test(r.emp_no)) throw new Invalid("사번은 영문·숫자·하이픈(-)만 20자 이내로 입력해 주세요.");
  const ps = d.past_sat;
  r.past_sat = ps == null || ps === "" ? null : ps === "none" ? 0 : int(d, "past_sat", 1, 5, "지난 1년 교육 만족도");
  if (r.areas.includes("기타") && !r.area_other) throw new Invalid("기타 교육 분야 내용을 입력해 주세요.");
  if (!r.areas.includes("기타")) r.area_other = "";
  if (r.barriers.includes("기타") && !r.barrier_other) throw new Invalid("기타 어려운 점 내용을 입력해 주세요.");
  if (!r.barriers.includes("기타")) r.barrier_other = "";
  return r;
}

// ── 관리자 인증: 서명된 쿠키 (서버 메모리가 없는 Vercel 환경용) ──
function secret() {
  const pw = process.env.ADMIN_PASSWORD, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!pw || !key) throw new Error("ADMIN_PASSWORD 환경변수가 없습니다.");
  return crypto.createHash("sha256").update(`${pw}\0${key}`).digest(); // 비밀번호를 바꾸면 기존 로그인 무효
}
const sign = exp => crypto.createHmac("sha256", secret()).update(String(exp)).digest("base64url");

export function checkPassword(pw) {
  const a = crypto.createHash("sha256").update(String(pw ?? "")).digest();
  const b = crypto.createHash("sha256").update(process.env.ADMIN_PASSWORD ?? "").digest();
  return Boolean(process.env.ADMIN_PASSWORD) && crypto.timingSafeEqual(a, b);
}

export function sessionCookie() {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  return `sid=${exp}.${sign(exp)}; Max-Age=${SESSION_HOURS * 3600}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
export const clearCookie = "sid=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict";

export function isAdmin(req) {
  if (RESULTS_PUBLIC) return true;
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = Buffer.from(sign(exp)), got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// 한국 시간 "YYYY-MM-DD HH:MM:SS"
export function kst(iso) {
  return new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 19);
}

// ── 전체 응답 읽기 (Supabase 기본 1000건 제한을 넘어 페이지 단위로) ──
export async function fetchAll(filters = {}) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = db().from("responses").select("*").order("updated_at", { ascending: false }).range(from, from + 999);
    for (const [k, v] of Object.entries(filters)) if (v) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
