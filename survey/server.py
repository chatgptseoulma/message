"""사내 교육 수요 설문 서버 (Python 표준 라이브러리 + SQLite, 추가 설치 불필요)

실행:  python server.py        → http://127.0.0.1:8000 (이 노트북에서만 접속 가능)
설문:  /       관리자 결과: /results (비밀번호: admin_password.txt)
"""
import csv
import hmac
import io
import json
import re
import secrets
import sqlite3
import sys
import threading
import time
from datetime import datetime
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

HOST, PORT = "127.0.0.1", 8000
BASE = Path(__file__).resolve().parent
DB_PATH = BASE / "survey.db"
PW_PATH = BASE / "admin_password.txt"
STATIC = BASE / "static"
SESSION_HOURS = 8

# ── 설문 선택지 (화면도 /api/config 로 이 값을 받아 그립니다) ──────────────
OPTIONS = {
    "ranks": ["사원", "주임·대리", "과장", "차장", "부장 이상"],
    "areas": ["직무 전문성", "디지털·AI·데이터", "리더십·관리", "커뮤니케이션·협업",
              "문서·보고서 작성", "외국어", "자기계발·건강", "기타"],
    "methods": ["오프라인 집합", "실시간 온라인", "녹화 강의(이러닝)", "사내 멘토링·스터디", "외부 위탁"],
    "time_slots": ["근무시간 중", "점심시간", "퇴근 후", "주말"],
    "durations": ["1시간 이하", "2~4시간", "하루", "2일 이상"],
    "barriers": ["업무 부담", "시간 부족", "원하는 주제 없음", "교육 정보 부족", "기타"],
}
MAX_AREAS = 3
EMP_RE = re.compile(r"^[A-Za-z0-9-]{1,20}$")

db_lock = threading.Lock()
sessions = {}  # token -> 만료 시각(epoch)
sessions_lock = threading.Lock()


# ── DB ──────────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS responses (
                emp_no TEXT PRIMARY KEY,          -- 사번 (사번당 1건, 재제출 시 덮어씀)
                name TEXT NOT NULL,
                dept TEXT NOT NULL,
                rank TEXT NOT NULL,
                areas TEXT NOT NULL,              -- JSON 배열
                area_other TEXT,
                priority_topic TEXT,
                skill INTEGER NOT NULL CHECK (skill BETWEEN 1 AND 5),
                methods TEXT NOT NULL,            -- JSON 배열
                time_slot TEXT NOT NULL,
                duration TEXT NOT NULL,
                past_sat INTEGER,                 -- 1~5, 0 = 받은 적 없음, NULL = 무응답
                barriers TEXT NOT NULL,           -- JSON 배열
                barrier_other TEXT,
                comment TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )


def admin_password():
    if not PW_PATH.exists():
        PW_PATH.write_text(secrets.token_urlsafe(9), encoding="utf-8")
    return PW_PATH.read_text(encoding="utf-8").strip()


# ── 입력 검증 ────────────────────────────────────────────────────────────────
def _text(data, key, maxlen, required=False, label=""):
    v = str(data.get(key) or "").strip()
    if required and not v:
        raise ValueError(f"{label}을(를) 입력해 주세요.")
    if len(v) > maxlen:
        raise ValueError(f"{label}은(는) {maxlen}자 이내로 입력해 주세요.")
    return v


def _one(data, key, choices, label):
    v = data.get(key)
    if v not in choices:
        raise ValueError(f"{label}을(를) 선택해 주세요.")
    return v


def _many(data, key, choices, label, min_n=0, max_n=None):
    v = data.get(key) or []
    if not isinstance(v, list) or any(x not in choices for x in v):
        raise ValueError(f"{label} 값이 올바르지 않습니다.")
    v = sorted(set(v), key=choices.index)
    if len(v) < min_n:
        raise ValueError(f"{label}을(를) {min_n}개 이상 선택해 주세요.")
    if max_n and len(v) > max_n:
        raise ValueError(f"{label}은(는) 최대 {max_n}개까지 선택할 수 있습니다.")
    return v


def _int(data, key, lo, hi, label):
    try:
        v = int(data.get(key))
    except (TypeError, ValueError):
        raise ValueError(f"{label}을(를) 선택해 주세요.")
    if not lo <= v <= hi:
        raise ValueError(f"{label}은(는) {lo}~{hi} 사이여야 합니다.")
    return v


def validate(data):
    if not isinstance(data, dict):
        raise ValueError("잘못된 요청입니다.")
    r = {
        "name": _text(data, "name", 30, True, "이름"),
        "emp_no": _text(data, "emp_no", 20, True, "사번"),
        "dept": _text(data, "dept", 50, True, "부서"),
        "rank": _one(data, "rank", OPTIONS["ranks"], "직급"),
        "areas": _many(data, "areas", OPTIONS["areas"], "교육 분야", 1, MAX_AREAS),
        "area_other": _text(data, "area_other", 100, label="기타 교육 분야"),
        "priority_topic": _text(data, "priority_topic", 100, label="우선 교육 주제"),
        "skill": _int(data, "skill", 1, 5, "직무 역량 자기평가"),
        "methods": _many(data, "methods", OPTIONS["methods"], "선호 교육 방식", 1),
        "time_slot": _one(data, "time_slot", OPTIONS["time_slots"], "선호 시간대"),
        "duration": _one(data, "duration", OPTIONS["durations"], "적정 교육 시간"),
        "barriers": _many(data, "barriers", OPTIONS["barriers"], "어려운 점"),
        "barrier_other": _text(data, "barrier_other", 100, label="기타 어려운 점"),
        "comment": _text(data, "comment", 1000, label="자유 의견"),
    }
    if not EMP_RE.match(r["emp_no"]):
        raise ValueError("사번은 영문·숫자·하이픈(-)만 20자 이내로 입력해 주세요.")
    ps = data.get("past_sat")
    if ps in (None, ""):
        r["past_sat"] = None
    elif ps == "none":
        r["past_sat"] = 0
    else:
        r["past_sat"] = _int(data, "past_sat", 1, 5, "지난 1년 교육 만족도")
    if "기타" in r["areas"] and not r["area_other"]:
        raise ValueError("기타 교육 분야 내용을 입력해 주세요.")
    if "기타" not in r["areas"]:
        r["area_other"] = ""
    if "기타" in r["barriers"] and not r["barrier_other"]:
        raise ValueError("기타 어려운 점 내용을 입력해 주세요.")
    if "기타" not in r["barriers"]:
        r["barrier_other"] = ""
    return r


def save(r):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    vals = dict(r, areas=json.dumps(r["areas"], ensure_ascii=False),
                methods=json.dumps(r["methods"], ensure_ascii=False),
                barriers=json.dumps(r["barriers"], ensure_ascii=False), now=now)
    with db_lock, get_db() as conn:
        existed = conn.execute("SELECT 1 FROM responses WHERE emp_no=?", (r["emp_no"],)).fetchone()
        conn.execute(
            """INSERT INTO responses (emp_no, name, dept, rank, areas, area_other, priority_topic, skill,
                   methods, time_slot, duration, past_sat, barriers, barrier_other, comment, created_at, updated_at)
               VALUES (:emp_no, :name, :dept, :rank, :areas, :area_other, :priority_topic, :skill,
                   :methods, :time_slot, :duration, :past_sat, :barriers, :barrier_other, :comment, :now, :now)
               ON CONFLICT(emp_no) DO UPDATE SET
                   name=excluded.name, dept=excluded.dept, rank=excluded.rank, areas=excluded.areas,
                   area_other=excluded.area_other, priority_topic=excluded.priority_topic, skill=excluded.skill,
                   methods=excluded.methods, time_slot=excluded.time_slot, duration=excluded.duration,
                   past_sat=excluded.past_sat, barriers=excluded.barriers, barrier_other=excluded.barrier_other,
                   comment=excluded.comment, updated_at=excluded.updated_at""",
            vals,
        )
    return bool(existed)


# ── 집계 ────────────────────────────────────────────────────────────────────
def summary(dept="", rank=""):
    where, args = [], []
    if dept:
        where.append("dept = ?"); args.append(dept)
    if rank:
        where.append("rank = ?"); args.append(rank)
    sql = "SELECT * FROM responses" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY updated_at DESC"
    with get_db() as conn:
        rows = conn.execute(sql, args).fetchall()
        depts = [r[0] for r in conn.execute("SELECT DISTINCT dept FROM responses ORDER BY dept")]

    def count(key, choices, is_json=False):
        c = {k: 0 for k in choices}
        for r in rows:
            for v in (json.loads(r[key]) if is_json else [r[key]]):
                c[v] = c.get(v, 0) + 1
        return c

    n = len(rows)
    sats = [r["past_sat"] for r in rows if r["past_sat"]]
    texts = []
    for r in rows:
        if r["priority_topic"] or r["area_other"] or r["barrier_other"] or r["comment"]:
            texts.append({k: r[k] for k in ("name", "emp_no", "dept", "rank", "priority_topic",
                                            "area_other", "barrier_other", "comment", "updated_at")})
    return {
        "count": n,
        "avg_skill": round(sum(r["skill"] for r in rows) / n, 2) if n else None,
        "avg_past_sat": round(sum(sats) / len(sats), 2) if sats else None,
        "past_none": sum(1 for r in rows if r["past_sat"] == 0),
        "areas": count("areas", OPTIONS["areas"], True),
        "methods": count("methods", OPTIONS["methods"], True),
        "time_slots": count("time_slot", OPTIONS["time_slots"]),
        "durations": count("duration", OPTIONS["durations"]),
        "barriers": count("barriers", OPTIONS["barriers"], True),
        "ranks": count("rank", OPTIONS["ranks"]),
        "texts": texts,
        "depts": depts,
    }


def _cell(v):
    """엑셀 수식으로 해석되지 않게 막기 (CSV 인젝션 방지)"""
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s


def export_csv():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM responses ORDER BY dept, emp_no").fetchall()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["사번", "이름", "부서", "직급", "교육 분야", "기타 분야", "우선 교육 주제", "역량 자기평가",
                "선호 교육 방식", "선호 시간대", "적정 교육 시간", "지난 1년 교육 만족도",
                "어려운 점", "기타 어려운 점", "자유 의견", "최초 제출", "최종 수정"])
    for r in rows:
        ps = {None: "", 0: "받은 적 없음"}.get(r["past_sat"], r["past_sat"])
        w.writerow([_cell(x) for x in (
            r["emp_no"], r["name"], r["dept"], r["rank"], ", ".join(json.loads(r["areas"])), r["area_other"],
            r["priority_topic"], r["skill"], ", ".join(json.loads(r["methods"])), r["time_slot"], r["duration"],
            ps, ", ".join(json.loads(r["barriers"])), r["barrier_other"], r["comment"],
            r["created_at"], r["updated_at"])])
    return "﻿" + buf.getvalue()


# ── 인증 ────────────────────────────────────────────────────────────────────
def new_session():
    token = secrets.token_urlsafe(32)
    with sessions_lock:
        now = time.time()
        for t in [t for t, exp in sessions.items() if exp < now]:
            del sessions[t]
        sessions[token] = now + SESSION_HOURS * 3600
    return token


def valid_session(token):
    with sessions_lock:
        exp = sessions.get(token)
        return bool(exp and exp > time.time())


# ── HTTP ────────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body=b"", ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _page(self, name):
        self._send(200, (STATIC / name).read_bytes(), "text/html; charset=utf-8")

    def _authed(self):
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return "sid" in c and valid_session(c["sid"].value)

    def _json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > 20_000:
            raise ValueError("요청이 너무 큽니다.")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        u = urlsplit(self.path)
        p, q = u.path, parse_qs(u.query)
        if p in ("/", "/index.html"):
            return self._page("index.html")
        if p == "/api/config":
            return self._send(200, dict(OPTIONS, max_areas=MAX_AREAS))
        if p == "/login":
            return self._page("login.html")
        if p == "/logout":
            c = SimpleCookie(self.headers.get("Cookie", ""))
            if "sid" in c:
                with sessions_lock:
                    sessions.pop(c["sid"].value, None)
            return self._send(302, extra={"Location": "/login",
                                          "Set-Cookie": "sid=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"})
        if p in ("/results", "/api/summary", "/api/export.csv"):
            if not self._authed():
                if p == "/results":
                    return self._send(302, extra={"Location": "/login"})
                return self._send(401, {"error": "관리자 로그인이 필요합니다."})
            if p == "/results":
                return self._page("results.html")
            if p == "/api/summary":
                return self._send(200, summary(q.get("dept", [""])[0], q.get("rank", [""])[0]))
            fname = f"education_survey_{datetime.now():%Y%m%d_%H%M}.csv"
            return self._send(200, export_csv(), "text/csv; charset=utf-8",
                              {"Content-Disposition": f'attachment; filename="{fname}"'})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/api/responses":
            try:
                updated = save(validate(self._json_body()))
            except (ValueError, json.JSONDecodeError) as e:
                return self._send(400, {"error": str(e)})
            return self._send(200 if updated else 201, {"ok": True, "updated": updated})
        if self.path == "/api/login":
            try:
                pw = str(self._json_body().get("password") or "")
            except (ValueError, json.JSONDecodeError, AttributeError):
                pw = ""
            if hmac.compare_digest(pw.encode(), admin_password().encode()):
                token = new_session()
                return self._send(200, {"ok": True}, extra={
                    "Set-Cookie": f"sid={token}; Max-Age={SESSION_HOURS * 3600}; Path=/; HttpOnly; SameSite=Strict"})
            time.sleep(1)  # 무차별 대입 속도 늦추기
            return self._send(401, {"error": "비밀번호가 올바르지 않습니다."})
        self._send(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        print(f"[{datetime.now():%H:%M:%S}] {self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        s.reconfigure(encoding="utf-8", errors="replace")
    init_db()
    admin_password()
    print(f"설문 서버 실행 중: http://{HOST}:{PORT}", flush=True)
    print(f"관리자 비밀번호 파일: {PW_PATH}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
