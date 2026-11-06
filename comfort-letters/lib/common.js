// 공통: Supabase 클라이언트, 응답 헬퍼, 열쇠(토큰) 인증, 입력 검증, 사용량 제한
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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

export class Invalid extends Error {
  constructor(msg, code = 400) { super(msg); this.code = code; }
}

export function send(res, code, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(code).json(body);
}

// 핸들러 감싸기: Invalid는 사용자 메시지로, 나머지는 500
export const handle = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof Invalid) return send(res, e.code, { error: e.message });
    console.error(e);
    return send(res, 500, { error: "잠시 문제가 생겼어요. 조금 뒤 다시 시도해 주세요." });
  }
};

export function body(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = null; } }
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new Invalid("잘못된 요청이에요.");
  return b;
}

export function text(v, { min = 0, max, label }) {
  // 글자 대신 객체·배열 등이 오면 "[object Object]"로 저장되지 않게 거부 (보안점검 V-11)
  if (v != null && typeof v !== "string") throw new Invalid(`${label} 형식이 올바르지 않아요.`);
  const s = String(v ?? "").replace(/\r\n/g, "\n").trim();
  if (s.length < min) throw new Invalid(min === 1 ? `${label}을(를) 적어 주세요.` : `${label}은(는) ${min}자 이상이어야 해요.`);
  if (s.length > max) throw new Invalid(`${label}은(는) ${max}자까지 적을 수 있어요.`);
  return s;
}

// 정확한 uuid 형식만 (느슨하면 DB까지 가서 500 이 났음 — 보안점검 V-11 / 알려진 버그 7)
export const isUuid = s => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// 메시지 번호: 숫자만 (예: "12abc" 를 12 로 받아들이지 않게). 아니면 null
export const positiveId = v => {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,15}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
};

// 닉네임에서 보이지 않는 글자(폭 없는 공백, 글자 방향 바꾸기 등)를 지움 — 남 흉내 방지 (보안점검 V-11)
// 이모지를 잇는 ZWJ(U+200D)는 남긴다
export const stripInvisible = s => typeof s === "string" ? s.replace(/[​‎‏‪-‮⁠-⁤⁦-⁩﻿]/g, "") : s;

// 프로필 이모티콘(다양한 사람 모양): 이 목록에서만 고를 수 있다 (빈 문자열 = 이모티콘 없음, 닉네임 첫 글자 표시)
export const EMOJIS = [
  "👩", "👨", "🧑", "👧🏻", "👦🏽", "👵🏼", "👴🏾", "🧓", "👶🏻", "👩‍🦰",
  "👨‍🦱", "👩🏿‍🦱", "👨🏼‍🦳", "👩‍🦳", "👨🏽‍🦲", "👱‍♀️", "👱🏾‍♂️", "🧔🏻", "🧕🏽", "👳🏿‍♂️",
  "👩‍💼", "👨🏾‍💼", "🧑🏼‍💼", "👩🏻‍💻", "👨‍💻", "🧑🏿‍💻", "👩🏽‍🔧", "👨‍🍳", "👩🏼‍🏫", "👨🏻‍⚕️",
  "👩🏾‍🎨", "🧑‍🚀", "🙋‍♀️", "🙋🏽‍♂️", "🤷🏻‍♀️", "🤷🏿‍♂️", "🙆🏼‍♀️", "🙅‍♂️", "💁🏾‍♀️", "🤦‍♂️",
];
export function emoji(v) {
  if (v === undefined) return undefined;   // 안 보냈으면 그대로 둠
  const s = String(v ?? "");
  if (s !== "" && !EMOJIS.includes(s)) throw new Invalid("고를 수 있는 이모티콘이 아니에요.");
  return s;
}

// ── 열쇠: 브라우저에 보관하는 무작위 문자열. 서버는 해시만 저장 ──
export const newToken = () => crypto.randomBytes(24).toString("base64url");
export const hashToken = t => crypto.createHash("sha256").update(t).digest("hex");

// 열쇠 → 사용자 캐시 (같은 서버 인스턴스 안에서 1분간 재사용해 DB 왕복을 줄임)
const userCache = new Map();
export const forgetUser = hash => userCache.delete(hash);

export async function currentUser(req, { required = true } = {}) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,64})$/.exec(req.headers.authorization || "");
  if (!m) { if (required) throw new Invalid("먼저 닉네임을 정해 주세요.", 401); return null; }
  const h = hashToken(m[1]);
  const hit = userCache.get(h);
  if (hit && hit.exp > Date.now()) return hit.user;
  // created_at: 계정을 만든 시각. 이보다 먼저 만들어진 하소연 방은 이 사용자에게 보이지 않는다 (lib/rooms.js)
  const { data, error } = await db().from("cb_users").select("id, nickname, emoji, created_at").eq("token_hash", h).maybeSingle();
  if (error) throw error;
  if (!data) {
    userCache.delete(h);
    if (required) throw new Invalid("열쇠가 맞지 않아요. 처음 화면에서 다시 시작해 주세요.", 401);
    return null;
  }
  if (userCache.size > 5000) userCache.clear();
  userCache.set(h, { user: data, exp: Date.now() + 60_000 });
  return data;
}
export const userHash = req => {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,64})$/.exec(req.headers.authorization || "");
  return m ? hashToken(m[1]) : null;
};

// ── 생성 남용 제한 (보안점검 V-02) ──
export const SIGNUPS_PER_IP_PER_DAY = 20;
export const ROOMS_PER_DAY = 10;

// 접속 주소: Vercel 이 넣어 주는 x-forwarded-for 의 첫 번째 값. 없으면 null (제한을 건너뜀)
export function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = xff || String(req.headers["x-real-ip"] || "").trim();
  return ip && ip.length <= 64 ? ip : null;
}
// IP 원문은 저장하지 않고, 서버 비밀값으로 만든 해시만 저장
export function ipHash(ip) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "no-key";
  return crypto.createHmac("sha256", key).update("cl-ip:" + ip).digest("hex");
}

// 도배 방지 (메신저라 넉넉하게): 1분 20개, 하루 500개까지. 쿼리 한 번으로 확인
export async function checkRate(userId) {
  const { data, error } = await db().from("cb_messages").select("created_at")
    .eq("author_id", userId).gte("created_at", new Date(Date.now() - 86_400_000).toISOString())
    .order("id", { ascending: false }).limit(500);
  if (error) throw error;
  const minuteAgo = Date.now() - 60_000;
  if (data.filter(r => Date.parse(r.created_at) > minuteAgo).length >= 20) throw new Invalid("워워, 너무 빨라요. 1분만 숨 돌리고 다시 보내요.", 429);
  if (data.length >= 500) throw new Invalid("오늘은 쏟아낼 만큼 쏟아냈어요. 나머진 내일 마저 해요.", 429);
}
