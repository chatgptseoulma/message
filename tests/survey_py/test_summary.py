"""GET /api/summary aggregate numbers and filters."""
import time
import urllib.parse

from base import EXPECTED_OPTIONS, SurveyTestCase


def zeros(key):
    return {k: 0 for k in EXPECTED_OPTIONS[key]}


class TestSummary(SurveyTestCase):
    def setUp(self):
        super().setUp()
        self.cookie = self.login()

    def test_empty(self):
        s = self.summary(self.cookie)
        self.assertEqual(s, {
            "count": 0, "avg_skill": None, "avg_past_sat": None, "past_none": 0,
            "areas": zeros("areas"), "methods": zeros("methods"), "time_slots": zeros("time_slots"),
            "durations": zeros("durations"), "barriers": zeros("barriers"), "ranks": zeros("ranks"),
            "texts": [], "depts": []})
        self.assertEqual(list(s.keys()), ["count", "avg_skill", "avg_past_sat", "past_none", "areas", "methods",
                                          "time_slots", "durations", "barriers", "ranks", "texts", "depts"])

    def seed(self):
        self.assert_submit_ok(emp_no="A1", dept="인사팀", rank="사원", skill=1, past_sat="none",
                              areas=["외국어", "직무 전문성"], methods=["외부 위탁"], time_slot="주말",
                              duration="하루", barriers=["업무 부담", "시간 부족"])
        self.assert_submit_ok(emp_no="A2", dept="인사팀", rank="과장", skill=2, past_sat=4,
                              areas=["외국어"], methods=["외부 위탁", "오프라인 집합"], time_slot="주말",
                              duration="1시간 이하", barriers=["업무 부담"])
        self.assert_submit_ok(emp_no="B1", dept="개발팀", rank="사원", skill=2, past_sat="",
                              areas=["기타"], area_other="요리", methods=["실시간 온라인"],
                              time_slot="퇴근 후", duration="하루", barriers=[])
        self.assert_submit_ok(emp_no="B2", dept="개발팀", rank="사원", skill=5, past_sat=5,
                              areas=["디지털·AI·데이터"], methods=["실시간 온라인"],
                              time_slot="점심시간", duration="2일 이상", barriers=["기타"], barrier_other="육아")

    def test_numbers_all(self):
        self.seed()
        s = self.summary(self.cookie)
        self.assertEqual(s["count"], 4)
        self.assertEqual(s["avg_skill"], 2.5)               # (1+2+2+5)/4
        self.assertEqual(s["avg_past_sat"], 4.5)            # (4+5)/2, excludes 0 and NULL
        self.assertEqual(s["past_none"], 1)
        self.assertEqual(s["depts"], sorted(["개발팀", "인사팀"]))
        self.assertEqual(s["areas"], dict(zeros("areas"), **{"외국어": 2, "직무 전문성": 1, "기타": 1,
                                                               "디지털·AI·데이터": 1}))
        self.assertEqual(list(s["areas"].keys()), EXPECTED_OPTIONS["areas"])
        self.assertEqual(s["methods"], dict(zeros("methods"), **{"외부 위탁": 2, "오프라인 집합": 1, "실시간 온라인": 2}))
        self.assertEqual(list(s["methods"].keys()), EXPECTED_OPTIONS["methods"])
        self.assertEqual(s["time_slots"], dict(zeros("time_slots"), **{"주말": 2, "퇴근 후": 1, "점심시간": 1}))
        self.assertEqual(list(s["time_slots"].keys()), EXPECTED_OPTIONS["time_slots"])
        self.assertEqual(s["durations"], dict(zeros("durations"), **{"하루": 2, "1시간 이하": 1, "2일 이상": 1}))
        self.assertEqual(list(s["durations"].keys()), EXPECTED_OPTIONS["durations"])
        self.assertEqual(s["barriers"], dict(zeros("barriers"), **{"업무 부담": 2, "시간 부족": 1, "기타": 1}))
        self.assertEqual(list(s["barriers"].keys()), EXPECTED_OPTIONS["barriers"])
        self.assertEqual(s["ranks"], dict(zeros("ranks"), **{"사원": 3, "과장": 1}))
        self.assertEqual(list(s["ranks"].keys()), EXPECTED_OPTIONS["ranks"])

    def test_avg_rounding(self):
        for i, sk in enumerate((1, 2, 2)):
            self.assert_submit_ok(emp_no=f"R{i}", skill=sk, past_sat=[1, 1, 2][i])
        s = self.summary(self.cookie)
        self.assertEqual(s["avg_skill"], 1.67)
        self.assertEqual(s["avg_past_sat"], 1.33)

    def test_avg_past_sat_none_when_only_zero_or_null(self):
        self.assert_submit_ok(emp_no="N1", past_sat="none")
        self.assert_submit_ok(emp_no="N2", past_sat="")
        s = self.summary(self.cookie)
        self.assertIsNone(s["avg_past_sat"])
        self.assertEqual(s["past_none"], 1)
        self.assertEqual(s["avg_skill"], 3)

    def test_whole_number_average_serialised_as_float(self):
        self.assert_submit_ok(emp_no="I1", skill=4, past_sat=2)
        r = self.get("/api/summary", cookie=self.cookie)
        self.assertIn(b'"avg_skill": 4.0', r.body)
        self.assertIn(b'"avg_past_sat": 2.0', r.body)

    def test_dept_filter(self):
        self.seed()
        s = self.summary(self.cookie, dept="개발팀")
        self.assertEqual(s["count"], 2)
        self.assertEqual(s["avg_skill"], 3.5)
        self.assertEqual(s["avg_past_sat"], 5)
        self.assertEqual(s["past_none"], 0)
        self.assertEqual(s["depts"], sorted(["개발팀", "인사팀"]))  # unfiltered
        self.assertEqual(s["ranks"], dict(zeros("ranks"), **{"사원": 2}))

    def test_rank_filter_and_combined(self):
        self.seed()
        s = self.summary(self.cookie, rank="사원")
        self.assertEqual(s["count"], 3)
        s = self.summary(self.cookie, dept="인사팀", rank="사원")
        self.assertEqual(s["count"], 1)
        self.assertEqual(s["past_none"], 1)
        self.assertIsNone(s["avg_past_sat"])
        s = self.summary(self.cookie, dept="인사팀", rank="차장")
        self.assertEqual(s["count"], 0)
        self.assertIsNone(s["avg_skill"])
        self.assertEqual(s["areas"], zeros("areas"))
        self.assertEqual(s["depts"], sorted(["개발팀", "인사팀"]))

    def test_filter_exact_match_and_empty_params(self):
        self.seed()
        self.assertEqual(self.summary(self.cookie, dept="개발")["count"], 0)
        self.assertEqual(self.summary(self.cookie, dept="개발팀 ")["count"], 0)
        self.assertEqual(self.summary(self.cookie, dept="", rank="")["count"], 4)
        r = self.get("/api/summary?dept=&rank=", cookie=self.cookie)
        self.assertEqual(r.json()["count"], 4)
        self.assertEqual(self.summary(self.cookie, unknown="x")["count"], 4)

    def test_quirk_repeated_param_uses_first(self):
        self.seed()
        q = urllib.parse.urlencode([("dept", "개발팀"), ("dept", "인사팀")])
        r = self.get("/api/summary?" + q, cookie=self.cookie)
        self.assertEqual(r.json()["count"], 2)
        self.assertEqual({t["emp_no"] for t in r.json()["texts"]}, {"B1", "B2"})

    def test_depts_sorted_distinct(self):
        for i, d in enumerate(["다팀", "가팀", "나팀", "가팀"]):
            self.assert_submit_ok(emp_no=f"D{i}", dept=d)
        self.assertEqual(self.summary(self.cookie, dept="나팀")["depts"], ["가팀", "나팀", "다팀"])

    def test_texts(self):
        self.seed()
        self.assert_submit_ok(emp_no="C1", name="코멘트맨", dept="영업팀", rank="차장", comment="좋아요")
        self.assert_submit_ok(emp_no="C2", priority_topic="엑셀")
        self.assert_submit_ok(emp_no="C3")  # no text at all -> excluded
        s = self.summary(self.cookie)
        by = {t["emp_no"]: t for t in s["texts"]}
        self.assertEqual(set(by), {"B1", "B2", "C1", "C2"})
        keys = ["name", "emp_no", "dept", "rank", "priority_topic", "area_other", "barrier_other",
                "comment", "updated_at"]
        for t in s["texts"]:
            self.assertEqual(list(t.keys()), keys)
            self.assertRegex(t["updated_at"], r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$")
        self.assertEqual({k: by["C1"][k] for k in keys[:-1]},
                         {"name": "코멘트맨", "emp_no": "C1", "dept": "영업팀", "rank": "차장",
                          "priority_topic": "", "area_other": "", "barrier_other": "", "comment": "좋아요"})
        self.assertEqual(by["B1"]["area_other"], "요리")
        self.assertEqual(by["B2"]["barrier_other"], "육아")
        self.assertEqual(by["C2"]["priority_topic"], "엑셀")
        # filters apply to texts
        s = self.summary(self.cookie, dept="개발팀")
        self.assertEqual({t["emp_no"] for t in s["texts"]}, {"B1", "B2"})

    def test_texts_ordered_by_updated_at_desc(self):
        self.assert_submit_ok(emp_no="T1", comment="첫째")
        time.sleep(1.1)
        self.assert_submit_ok(emp_no="T2", comment="둘째")
        time.sleep(1.1)
        self.assert_submit_ok(emp_no="T1", comment="첫째 수정")  # update moves it to the top
        s = self.summary(self.cookie)
        self.assertEqual([t["emp_no"] for t in s["texts"]], ["T1", "T2"])
        self.assertEqual(s["texts"][0]["comment"], "첫째 수정")
        self.assertEqual(s["count"], 2)
