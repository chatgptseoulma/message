"""Login / logout / session gating. Wrong-password tests sleep 1s each, so keep them few."""
import time

from base import SurveyTestCase


class TestLogin(SurveyTestCase):
    def test_login_success_sets_cookie(self):
        r = self.post("/api/login", {"password": self.srv.password})
        self.assertEqual(r.status, 200)
        self.assertEqual(r.json(), {"ok": True})
        cookies = r.header_all("Set-Cookie")
        self.assertEqual(len(cookies), 1)
        parts = [p.strip() for p in cookies[0].split(";")]
        name, _, token = parts[0].partition("=")
        self.assertEqual(name, "sid")
        self.assertGreaterEqual(len(token), 40)  # token_urlsafe(32) -> 43 chars
        self.assertRegex(token, r"^[A-Za-z0-9_-]+$")
        attrs = parts[1:]
        self.assertIn("HttpOnly", attrs)
        self.assertIn("SameSite=Strict", attrs)
        self.assertIn("Path=/", attrs)
        self.assertIn(f"Max-Age={8 * 3600}", attrs)

    def test_each_login_gets_new_token_and_both_stay_valid(self):
        a, b = self.login(), self.login()
        self.assertNotEqual(a, b)
        self.assertEqual(self.get("/api/summary", cookie=a).status, 200)
        self.assertEqual(self.get("/api/summary", cookie=b).status, 200)

    def test_wrong_password_401_after_delay(self):
        t0 = time.monotonic()
        r = self.post("/api/login", {"password": "wrong"})
        elapsed = time.monotonic() - t0
        self.assertEqual(r.status, 401)
        self.assertEqual(r.json(), {"error": "비밀번호가 올바르지 않습니다."})
        self.assertEqual(r.header_all("Set-Cookie"), [])
        self.assertGreaterEqual(elapsed, 0.9)

    def test_malformed_login_body_is_treated_as_wrong_password(self):
        # invalid JSON -> password "" -> 401 (also sleeps 1s)
        r = self.request("POST", "/api/login", body=b"{oops")
        self.assertEqual(r.status, 401)
        self.assertEqual(r.json(), {"error": "비밀번호가 올바르지 않습니다."})


class TestGating(SurveyTestCase):
    def test_results_redirects_when_not_logged_in(self):
        for cookie in (None, "sid=bogus", "other=1", "sid="):
            r = self.get("/results", cookie=cookie)
            self.assertEqual(r.status, 302, cookie)
            self.assertEqual(r.header("Location"), "/login")
            self.assertEqual(r.body, b"")

    def test_api_requires_login(self):
        for path in ("/api/summary", "/api/summary?dept=x", "/api/export.csv"):
            for cookie in (None, "sid=bogus"):
                r = self.get(path, cookie=cookie)
                self.assertEqual(r.status, 401, (path, cookie))
                self.assertEqual(r.json(), {"error": "관리자 로그인이 필요합니다."})

    def test_logged_in_access(self):
        c = self.login()
        self.assertEqual(self.get("/results", cookie=c).status, 200)
        self.assertEqual(self.get("/api/summary", cookie=c).status, 200)
        self.assertEqual(self.get("/api/export.csv", cookie=c).status, 200)

    def test_cookie_among_others(self):
        c = self.login()
        self.assertEqual(self.get("/api/summary", cookie=f"a=1; {c}; b=2").status, 200)

    def test_logout_clears_session(self):
        c = self.login()
        r = self.get("/logout", cookie=c)
        self.assertEqual(r.status, 302)
        self.assertEqual(r.header("Location"), "/login")
        self.assertEqual(r.header("Set-Cookie"), "sid=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict")
        self.assertEqual(self.get("/api/summary", cookie=c).status, 401)
        self.assertEqual(self.get("/results", cookie=c).status, 302)

    def test_logout_only_kills_own_session(self):
        a, b = self.login(), self.login()
        self.get("/logout", cookie=a)
        self.assertEqual(self.get("/api/summary", cookie=a).status, 401)
        self.assertEqual(self.get("/api/summary", cookie=b).status, 200)

    def test_logout_without_cookie(self):
        r = self.get("/logout")
        self.assertEqual(r.status, 302)
        self.assertEqual(r.header("Location"), "/login")
        self.assertTrue(r.header("Set-Cookie").startswith("sid=; Max-Age=0"))

    def test_quirk_logout_is_get_and_post_logout_is_404(self):
        self.assertEqual(self.post("/logout").status, 404)
