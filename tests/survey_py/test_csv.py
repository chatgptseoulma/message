"""GET /api/export.csv format."""
import csv
import io
import re
import urllib.parse

from base import SurveyTestCase

HEADER = ["사번", "이름", "부서", "직급", "교육 분야", "기타 분야", "우선 교육 주제", "역량 자기평가",
          "선호 교육 방식", "선호 시간대", "적정 교육 시간", "지난 1년 교육 만족도",
          "어려운 점", "기타 어려운 점", "자유 의견", "최초 제출", "최종 수정"]


class TestCsv(SurveyTestCase):
    def setUp(self):
        super().setUp()
        self.cookie = self.login()

    def parse(self, r):
        text = r.body.decode("utf-8")
        self.assertTrue(text.startswith("\ufeff"))
        return list(csv.reader(io.StringIO(text[1:], newline="")))

    def test_headers_and_empty(self):
        r = self.export(self.cookie)
        self.assertEqual(r.header("Content-Type"), "text/csv; charset=utf-8")
        self.assertTrue(r.body.startswith(b"\xef\xbb\xbf"))
        cd = r.header("Content-Disposition")
        self.assertRegex(cd, r'^attachment; filename="education_survey_\d{8}_\d{4}\.csv"$')
        rows = self.parse(r)
        self.assertEqual(rows, [HEADER])
        self.assertEqual(len(rows[0]), 17)
        # csv module default line terminator
        self.assertTrue(r.body.endswith(b"\r\n"))

    def test_filename_timestamp_is_now(self):
        import datetime
        before = datetime.datetime.now()
        cd = self.export(self.cookie).header("Content-Disposition")
        after = datetime.datetime.now()
        stamp = re.search(r"education_survey_(\d{8}_\d{4})\.csv", cd).group(1)
        allowed = {before.strftime("%Y%m%d_%H%M"), after.strftime("%Y%m%d_%H%M")}
        self.assertIn(stamp, allowed)

    def test_rows_values_and_order(self):
        self.assert_submit_ok(emp_no="B2", dept="인사팀", name="을", past_sat="none",
                              areas=["외국어", "직무 전문성"], methods=["외부 위탁", "오프라인 집합"],
                              barriers=["시간 부족", "업무 부담"])
        self.assert_submit_ok(emp_no="A9", dept="인사팀", name="갑", past_sat=3)
        self.assert_submit_ok(emp_no="Z1", dept="개발팀", name="병", past_sat="")
        rows = self.parse(self.export(self.cookie))
        self.assertEqual(rows[0], HEADER)
        body = rows[1:]
        # ORDER BY dept, emp_no  ("개발팀" < "인사팀")
        self.assertEqual([r[0] for r in body], ["Z1", "A9", "B2"])
        b2 = dict(zip(HEADER, body[2]))
        self.assertEqual(b2["교육 분야"], "직무 전문성, 외국어")
        self.assertEqual(b2["선호 교육 방식"], "오프라인 집합, 외부 위탁")
        self.assertEqual(b2["어려운 점"], "업무 부담, 시간 부족")
        self.assertEqual(b2["지난 1년 교육 만족도"], "받은 적 없음")
        self.assertEqual(dict(zip(HEADER, body[1]))["지난 1년 교육 만족도"], "3")
        self.assertEqual(dict(zip(HEADER, body[0]))["지난 1년 교육 만족도"], "")
        for r in body:
            self.assertEqual(len(r), 17)
            self.assertRegex(r[15], r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$")
            self.assertRegex(r[16], r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$")

    def test_csv_ignores_summary_filters(self):
        self.assert_submit_ok(emp_no="A1", dept="가팀")
        self.assert_submit_ok(emp_no="A2", dept="나팀")
        q = urllib.parse.urlencode({"dept": "가팀", "rank": "과장"})
        r = self.get("/api/export.csv?" + q, cookie=self.cookie)
        self.assertEqual(len(self.parse(r)) - 1, 2)

    def test_formula_injection_prefix(self):
        self.assert_submit_ok(emp_no="-A1", name="=SUM(A1)", dept="+팀", priority_topic="@cmd",
                              comment="-1+2", areas=["기타"], area_other="=x",
                              barriers=["기타"], barrier_other="+y")
        row = self.stored("'-A1", self.cookie)
        self.assertEqual(row["사번"], "'-A1")
        self.assertEqual(row["이름"], "'=SUM(A1)")
        self.assertEqual(row["부서"], "'+팀")
        self.assertEqual(row["우선 교육 주제"], "'@cmd")
        self.assertEqual(row["자유 의견"], "'-1+2")
        self.assertEqual(row["기타 분야"], "'=x")
        self.assertEqual(row["기타 어려운 점"], "'+y")

    def test_no_prefix_when_special_char_not_leading(self):
        self.assert_submit_ok(name="a=b", comment="1-2 @x")
        row = self.stored("E001", self.cookie)
        self.assertEqual(row["이름"], "a=b")
        self.assertEqual(row["자유 의견"], "1-2 @x")

    def test_quirk_leading_tab_or_cr_is_stripped_before_storage(self):
        # Docs: the CSV guard does not cover leading TAB/CR. Through the API they cannot reach the
        # CSV anyway, because _text() strips surrounding whitespace first ("\t=1" -> "=1" -> "'=1").
        self.assert_submit_ok(name="\t=1", comment="\r=2")
        row = self.stored("E001", self.cookie)
        self.assertEqual(row["이름"], "'=1")
        self.assertEqual(row["자유 의견"], "'=2")

    def test_quoting_commas_quotes_newlines(self):
        self.assert_submit_ok(name='a,"b"', comment="줄1\n줄2")
        r = self.export(self.cookie)
        self.assertIn('"a,""b"""'.encode("utf-8"), r.body)
        row = self.stored("E001", self.cookie)
        self.assertEqual(row["이름"], 'a,"b"')
        self.assertEqual(row["자유 의견"], "줄1\n줄2")
