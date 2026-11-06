"""Black-box HTTP helpers + shared TestCase base. No knowledge of server internals here."""
import http.client
import json
import unittest
import urllib.parse
import warnings

import harness


class Resp:
    def __init__(self, r, body):
        self.status = r.status
        self.headers = r.headers  # email.message.Message (case-insensitive)
        self.body = body

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body.decode("utf-8"))

    def header(self, name):
        return self.headers.get(name)

    def header_all(self, name):
        return self.headers.get_all(name) or []


EXPECTED_OPTIONS = {
    "ranks": ["사원", "주임·대리", "과장", "차장", "부장 이상"],
    "areas": ["직무 전문성", "디지털·AI·데이터", "리더십·관리", "커뮤니케이션·협업",
              "문서·보고서 작성", "외국어", "자기계발·건강", "기타"],
    "methods": ["오프라인 집합", "실시간 온라인", "녹화 강의(이러닝)", "사내 멘토링·스터디", "외부 위탁"],
    "time_slots": ["근무시간 중", "점심시간", "퇴근 후", "주말"],
    "durations": ["1시간 이하", "2~4시간", "하루", "2일 이상"],
    "barriers": ["업무 부담", "시간 부족", "원하는 주제 없음", "교육 정보 부족", "기타"],
}


def valid_payload(**over):
    """A minimal fully-valid survey answer; override any field via kwargs."""
    d = {
        "name": "홍길동",
        "emp_no": "E001",
        "dept": "인사팀",
        "rank": "사원",
        "areas": ["직무 전문성"],
        "area_other": "",
        "priority_topic": "",
        "skill": 3,
        "methods": ["오프라인 집합"],
        "time_slot": "근무시간 중",
        "duration": "1시간 이하",
        "past_sat": "",
        "barriers": [],
        "barrier_other": "",
        "comment": "",
    }
    d.update(over)
    return d


class SurveyTestCase(unittest.TestCase):
    """Starts one isolated server per test class; empties the DB before each test."""

    @classmethod
    def setUpClass(cls):
        # Known gotcha: the app never closes its sqlite connections -> ResourceWarning noise.
        # (unittest installs its own warning filters per run, so this must be added here.)
        warnings.filterwarnings("ignore", message="unclosed database", category=ResourceWarning)
        cls.srv = harness.start_server()

    @classmethod
    def tearDownClass(cls):
        cls.srv.stop()

    def setUp(self):
        self.srv.reset_db()

    # ── raw HTTP (http.client: never follows redirects) ──
    def request(self, method, path, body=None, headers=None, cookie=None):
        conn = http.client.HTTPConnection(self.srv.host, self.srv.port, timeout=15)
        try:
            h = dict(headers or {})
            if cookie is not None:
                h["Cookie"] = cookie
            if isinstance(body, (dict, list)):
                body = json.dumps(body, ensure_ascii=False).encode("utf-8")
                h.setdefault("Content-Type", "application/json")
            elif isinstance(body, str):
                body = body.encode("utf-8")
            conn.request(method, path, body=body, headers=h)
            r = conn.getresponse()
            return Resp(r, r.read())
        finally:
            conn.close()

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.request("POST", path, body=body, **kw)

    def submit(self, **over):
        return self.post("/api/responses", valid_payload(**over))

    def assert_submit_ok(self, **over):
        r = self.submit(**over)
        self.assertIn(r.status, (200, 201), r.text)
        return r

    def assert_rejected(self, payload, msg_part=None):
        r = self.post("/api/responses", payload)
        self.assertEqual(r.status, 400, r.text)
        err = r.json()["error"]
        self.assertIsInstance(err, str)
        if msg_part is not None:
            self.assertIn(msg_part, err)
        return err

    # ── auth ──
    def login(self):
        r = self.post("/api/login", {"password": self.srv.password})
        self.assertEqual(r.status, 200, r.text)
        sc = r.header("Set-Cookie")
        token = sc.split(";", 1)[0].split("=", 1)[1]
        return "sid=" + token

    def export(self, cookie):
        r = self.get("/api/export.csv", cookie=cookie)
        self.assertEqual(r.status, 200, r.text)
        return r

    def csv_rows(self, cookie):
        """Return list of dicts (Korean header -> cell) from the CSV export."""
        import csv
        import io
        text = self.export(cookie).body.decode("utf-8-sig")
        rows = list(csv.reader(io.StringIO(text, newline="")))
        header = rows[0]
        return [dict(zip(header, row)) for row in rows[1:]]

    def stored(self, emp_no, cookie=None):
        cookie = cookie or self.login()
        for row in self.csv_rows(cookie):
            if row["사번"] == emp_no:
                return row
        self.fail(f"{emp_no} not found in export")

    def summary(self, cookie, **params):
        qs = urllib.parse.urlencode(params)
        r = self.get("/api/summary" + ("?" + qs if qs else ""), cookie=cookie)
        self.assertEqual(r.status, 200, r.text)
        return r.json()
