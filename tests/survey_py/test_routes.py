"""Routes, static pages, /api/config, common headers, 404s."""
import http.client

from base import EXPECTED_OPTIONS, SurveyTestCase


class TestStaticPages(SurveyTestCase):
    def assert_html(self, r, name):
        self.assertEqual(r.status, 200)
        self.assertEqual(r.header("Content-Type"), "text/html; charset=utf-8")
        self.assertEqual(r.body, self.srv.static_bytes(name))
        self.assertEqual(int(r.header("Content-Length")), len(r.body))

    def test_root_serves_index(self):
        r = self.get("/")
        self.assert_html(r, "index.html")
        for needle in ('id="f"', 'id="name"', 'id="emp_no"', 'id="dept"', 'id="rank"', 'id="areas"',
                       'id="maxa"', 'id="skill"', 'id="methods"', 'id="time_slot"', 'id="duration"',
                       'id="past_sat"', 'id="barriers"', 'id="msg"', 'id="done"', 'id="doneMsg"',
                       'name="area_other"', 'name="barrier_other"', 'name="comment"',
                       'name="priority_topic"', '"/api/config"', '"/api/responses"',
                       "<title>사내 교육 수요 조사</title>"):
            self.assertIn(needle, r.text, needle)

    def test_index_html_path(self):
        self.assert_html(self.get("/index.html"), "index.html")

    def test_query_string_ignored_on_get(self):
        self.assert_html(self.get("/?x=1"), "index.html")
        self.assert_html(self.get("/login?next=/results"), "login.html")

    def test_login_page(self):
        r = self.get("/login")
        self.assert_html(r, "login.html")
        for needle in ('id="f"', 'id="msg"', 'type="password"', 'name="password"',
                       '"/api/login"', '"/results"', "<title>관리자 로그인</title>"):
            self.assertIn(needle, r.text, needle)

    def test_results_page_when_logged_in(self):
        r = self.get("/results", cookie=self.login())
        self.assert_html(r, "results.html")
        for needle in ('id="dept"', 'id="rank"', 'id="count"', 'id="skill"', 'id="sat"', 'id="none"',
                       'id="areas"', 'id="methods"', 'id="time_slots"', 'id="durations"',
                       'id="barriers"', 'id="ranks"', 'id="texts"', 'href="/api/export.csv"',
                       'href="/logout"', '"/api/summary?"', "<title>교육 수요 조사 결과</title>"):
            self.assertIn(needle, r.text, needle)

    def test_login_html_path_is_404(self):
        # only /login is routed; the file name itself is not
        self.assertEqual(self.get("/login.html").status, 404)
        self.assertEqual(self.get("/results.html").status, 404)
        self.assertEqual(self.get("/static/index.html").status, 404)


class TestConfig(SurveyTestCase):
    def test_config_exact(self):
        r = self.get("/api/config")
        self.assertEqual(r.status, 200)
        self.assertEqual(r.header("Content-Type"), "application/json; charset=utf-8")
        data = r.json()
        self.assertEqual(data, dict(EXPECTED_OPTIONS, max_areas=3))
        # key order of the object too
        self.assertEqual(list(data.keys()), list(EXPECTED_OPTIONS.keys()) + ["max_areas"])

    def test_config_is_raw_utf8_not_escaped(self):
        r = self.get("/api/config")
        self.assertIn("사원".encode("utf-8"), r.body)
        self.assertNotIn(b"\\u", r.body)


class TestNotFoundAndHeaders(SurveyTestCase):
    def assert_404(self, r):
        self.assertEqual(r.status, 404)
        self.assertEqual(r.json(), {"error": "not found"})
        self.assertEqual(r.header("Content-Type"), "application/json; charset=utf-8")

    def test_get_unknown(self):
        self.assert_404(self.get("/nope"))
        self.assert_404(self.get("/api/responses"))
        self.assert_404(self.get("/api/login"))
        self.assert_404(self.get("/api/config/"))
        self.assert_404(self.get("/results/"))

    # NOTE: 404/501 paths never read the request body; on Windows an unread body can turn the
    # server's close into a TCP RST that hides the response, so these requests send no body.
    def test_post_unknown(self):
        self.assert_404(self.post("/nope"))
        self.assert_404(self.post("/api/config"))
        self.assert_404(self.post("/"))

    def test_post_with_query_string_is_404(self):
        self.assert_404(self.post("/api/responses?x=1"))
        self.assert_404(self.post("/api/login?x=1"))

    def test_common_headers_on_every_response(self):
        cookie = self.login()
        responses = [
            self.get("/"), self.get("/login"), self.get("/api/config"), self.get("/nope"),
            self.get("/results"),                     # 302
            self.get("/api/summary"),                 # 401
            self.get("/api/summary", cookie=cookie),  # 200
            self.get("/api/export.csv", cookie=cookie),
            self.post("/api/responses", {}),          # 400
            self.get("/logout"),                      # 302
        ]
        for r in responses:
            self.assertEqual(r.header("X-Content-Type-Options"), "nosniff", r.status)
            self.assertEqual(r.header("Cache-Control"), "no-store", r.status)
            self.assertEqual(int(r.header("Content-Length")), len(r.body))

    def test_quirk_other_methods_are_501(self):
        # Quirk: BaseHTTPRequestHandler default for unimplemented methods (no do_PUT etc.).
        for method in ("PUT", "DELETE", "PATCH"):
            r = self.request(method, "/api/responses")
            self.assertEqual(r.status, 501, method)

    def test_quirk_http_version_is_1_0(self):
        # Quirk: default protocol_version, one request per connection.
        conn = http.client.HTTPConnection(self.srv.host, self.srv.port, timeout=10)
        try:
            conn.request("GET", "/api/config")
            r = conn.getresponse()
            r.read()
            self.assertEqual(r.version, 10)  # BaseHTTPRequestHandler default protocol_version
        finally:
            conn.close()
