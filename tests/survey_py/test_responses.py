"""POST /api/responses: happy path, upsert, and every validation rule (exact messages)."""
import http.client
import json
import time

from base import SurveyTestCase, valid_payload


class TestSubmitHappyPath(SurveyTestCase):
    def test_new_is_201(self):
        r = self.submit()
        self.assertEqual(r.status, 201)
        self.assertEqual(r.json(), {"ok": True, "updated": False})
        self.assertEqual(r.header("Content-Type"), "application/json; charset=utf-8")

    def test_resubmit_same_emp_no_is_200_updated_and_keeps_created_at(self):
        self.assertEqual(self.submit(name="처음").status, 201)
        cookie = self.login()
        first = self.stored("E001", cookie)
        self.assertEqual(first["최초 제출"], first["최종 수정"])
        time.sleep(1.1)  # timestamps have 1-second resolution
        r = self.submit(name="두번째", dept="재무팀", skill=5)
        self.assertEqual(r.status, 200)
        self.assertEqual(r.json(), {"ok": True, "updated": True})
        rows = self.csv_rows(cookie)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["이름"], "두번째")
        self.assertEqual(row["부서"], "재무팀")
        self.assertEqual(row["역량 자기평가"], "5")
        self.assertEqual(row["최초 제출"], first["최초 제출"])
        self.assertGreater(row["최종 수정"], row["최초 제출"])
        self.assertRegex(row["최초 제출"], r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$")

    def test_emp_no_is_case_sensitive(self):
        self.assertEqual(self.submit(emp_no="abc").status, 201)
        self.assertEqual(self.submit(emp_no="ABC").status, 201)
        self.assertEqual(self.summary(self.login())["count"], 2)

    def test_full_payload_roundtrip(self):
        p = valid_payload(
            name="  김철수 ", emp_no=" A-1 ", dept=" 개발팀 ", rank="과장",
            areas=["기타", "외국어", "직무 전문성", "외국어"], area_other=" 요리 ",
            priority_topic=" 엑셀 ", skill="4",
            methods=["외부 위탁", "오프라인 집합", "외부 위탁"], time_slot="주말", duration="하루",
            past_sat="5", barriers=["기타", "업무 부담"], barrier_other=" 육아 ", comment=" 좋아요 ")
        self.assertEqual(self.post("/api/responses", p).status, 201)
        row = self.stored("A-1")
        self.assertEqual(row, {
            "사번": "A-1", "이름": "김철수", "부서": "개발팀", "직급": "과장",
            "교육 분야": "직무 전문성, 외국어, 기타", "기타 분야": "요리", "우선 교육 주제": "엑셀",
            "역량 자기평가": "4", "선호 교육 방식": "오프라인 집합, 외부 위탁", "선호 시간대": "주말",
            "적정 교육 시간": "하루", "지난 1년 교육 만족도": "5", "어려운 점": "업무 부담, 기타",
            "기타 어려운 점": "육아", "자유 의견": "좋아요",
            "최초 제출": row["최초 제출"], "최종 수정": row["최종 수정"]})

    def test_optional_fields_may_be_missing(self):
        p = valid_payload()
        for k in ("area_other", "priority_topic", "past_sat", "barriers", "barrier_other", "comment"):
            del p[k]
        self.assertEqual(self.post("/api/responses", p).status, 201)
        row = self.stored("E001")
        self.assertEqual(row["어려운 점"], "")
        self.assertEqual(row["지난 1년 교육 만족도"], "")

    def test_body_exactly_20000_bytes_accepted(self):
        raw = json.dumps(valid_payload(), ensure_ascii=False).encode("utf-8")
        raw = raw + b" " * (20_000 - len(raw))
        self.assertEqual(len(raw), 20_000)
        r = self.request("POST", "/api/responses", body=raw, headers={"Content-Type": "application/json"})
        self.assertEqual(r.status, 201, r.text)


class TestBodyErrors(SurveyTestCase):
    def test_body_over_20000_bytes_rejected(self):
        # send only the header; server must reject based on Content-Length without reading
        conn = http.client.HTTPConnection(self.srv.host, self.srv.port, timeout=10)
        try:
            conn.putrequest("POST", "/api/responses")
            conn.putheader("Content-Type", "application/json")
            conn.putheader("Content-Length", "20001")
            conn.endheaders()
            r = conn.getresponse()
            self.assertEqual(r.status, 400)
            self.assertEqual(json.loads(r.read()), {"error": "요청이 너무 큽니다."})
        finally:
            conn.close()

    def test_invalid_json(self):
        r = self.request("POST", "/api/responses", body=b"{not json",
                         headers={"Content-Type": "application/json"})
        self.assertEqual(r.status, 400)
        self.assertIsInstance(r.json()["error"], str)
        self.assertTrue(r.json()["error"])

    def test_non_object_json(self):
        for body in (b"[1]", b'"x"', b"1", b"[]", b"null", b"true"):
            r = self.request("POST", "/api/responses", body=body)
            self.assertEqual(r.status, 400, body)
            self.assertEqual(r.json(), {"error": "잘못된 요청입니다."}, body)

    def test_invalid_utf8_body(self):
        r = self.request("POST", "/api/responses", body=b'{"name": "\xff\xfe"}')
        self.assertEqual(r.status, 400)

    def test_empty_body_treated_as_empty_object(self):
        r = self.request("POST", "/api/responses", body=b"")
        self.assertEqual(r.status, 400)
        self.assertEqual(r.json(), {"error": "이름을(를) 입력해 주세요."})

    def test_nothing_saved_on_error(self):
        self.assert_rejected(valid_payload(skill=9))
        self.assertEqual(self.summary(self.login())["count"], 0)


class TestTextFields(SurveyTestCase):
    def test_required_text_fields(self):
        cases = [("name", "이름을(를) 입력해 주세요."),
                 ("emp_no", "사번을(를) 입력해 주세요."),
                 ("dept", "부서을(를) 입력해 주세요.")]
        for key, msg in cases:
            for bad in ("", "   ", None):
                self.assertEqual(self.assert_rejected(valid_payload(**{key: bad})), msg, (key, bad))
            p = valid_payload()
            del p[key]
            self.assertEqual(self.assert_rejected(p), msg, key)

    def test_max_lengths(self):
        cases = [("name", 30, "이름은(는) 30자 이내로 입력해 주세요."),
                 ("dept", 50, "부서은(는) 50자 이내로 입력해 주세요."),
                 ("priority_topic", 100, "우선 교육 주제은(는) 100자 이내로 입력해 주세요."),
                 ("comment", 1000, "자유 의견은(는) 1000자 이내로 입력해 주세요.")]
        for i, (key, n, msg) in enumerate(cases):
            self.assertEqual(self.submit(emp_no=f"L{i}", **{key: "가" * n}).status, 201, key)
            # surrounding whitespace is stripped before the length check
            self.assertEqual(self.submit(emp_no=f"L{i}", **{key: "  " + "가" * n + "  "}).status, 200, key)
            self.assertEqual(self.assert_rejected(valid_payload(**{key: "가" * (n + 1)})), msg, key)

    def test_area_other_and_barrier_other_max_length(self):
        p = valid_payload(areas=["기타"], area_other="x" * 100)
        self.assertEqual(self.post("/api/responses", p).status, 201)
        self.assertEqual(self.assert_rejected(valid_payload(areas=["기타"], area_other="x" * 101)),
                         "기타 교육 분야은(는) 100자 이내로 입력해 주세요.")
        p = valid_payload(emp_no="B2", barriers=["기타"], barrier_other="x" * 100)
        self.assertEqual(self.post("/api/responses", p).status, 201)
        self.assertEqual(self.assert_rejected(valid_payload(barriers=["기타"], barrier_other="x" * 101)),
                         "기타 어려운 점은(는) 100자 이내로 입력해 주세요.")

    def test_emp_no_length_and_pattern(self):
        self.assertEqual(self.submit(emp_no="A" * 20).status, 201)
        self.assertEqual(self.submit(emp_no="a-Z-09").status, 201)
        self.assertEqual(self.submit(emp_no="-").status, 201)
        self.assertEqual(self.assert_rejected(valid_payload(emp_no="A" * 21)),
                         "사번은(는) 20자 이내로 입력해 주세요.")
        pat_msg = "사번은 영문·숫자·하이픈(-)만 20자 이내로 입력해 주세요."
        for bad in ("A 1", "A_1", "가나", "A.1", "A/1", "A1\n2", "Ａ1"):
            self.assertEqual(self.assert_rejected(valid_payload(emp_no=bad)), pat_msg, bad)

    def test_emp_no_is_stripped(self):
        self.assertEqual(self.submit(emp_no="  Z9  ").status, 201)
        self.assertEqual(self.submit(emp_no="Z9").status, 200)

    def test_quirk_emp_no_trailing_newline_after_strip(self):
        # "\n" is whitespace -> stripped, so "Z9\n" is accepted as "Z9" (regex `$` not reached)
        self.assertEqual(self.submit(emp_no="Z9\n").status, 201)
        self.stored("Z9")


class TestChoiceFields(SurveyTestCase):
    def test_rank(self):
        for v in ["사원", "주임·대리", "과장", "차장", "부장 이상"]:
            self.assertIn(self.submit(rank=v).status, (200, 201))
        for bad in ("", None, "대표", "사원 ", ["사원"], 1):
            self.assertEqual(self.assert_rejected(valid_payload(rank=bad)), "직급을(를) 선택해 주세요.", bad)

    def test_time_slot_and_duration(self):
        for v in ["근무시간 중", "점심시간", "퇴근 후", "주말"]:
            self.assertIn(self.submit(time_slot=v).status, (200, 201))
        for v in ["1시간 이하", "2~4시간", "하루", "2일 이상"]:
            self.assertIn(self.submit(duration=v).status, (200, 201))
        for bad in ("", None, "새벽"):
            self.assertEqual(self.assert_rejected(valid_payload(time_slot=bad)), "선호 시간대을(를) 선택해 주세요.")
            self.assertEqual(self.assert_rejected(valid_payload(duration=bad)), "적정 교육 시간을(를) 선택해 주세요.")

    def test_areas_count_bounds(self):
        self.assertEqual(self.assert_rejected(valid_payload(areas=[])), "교육 분야을(를) 1개 이상 선택해 주세요.")
        self.assertEqual(self.assert_rejected(valid_payload(areas=None)), "교육 분야을(를) 1개 이상 선택해 주세요.")
        p = valid_payload()
        del p["areas"]
        self.assertEqual(self.assert_rejected(p), "교육 분야을(를) 1개 이상 선택해 주세요.")
        self.assertEqual(self.submit(areas=["외국어", "리더십·관리", "직무 전문성"]).status, 201)
        self.assertEqual(self.assert_rejected(valid_payload(areas=["외국어", "리더십·관리", "직무 전문성", "자기계발·건강"])),
                         "교육 분야은(는) 최대 3개까지 선택할 수 있습니다.")

    def test_areas_dedup_happens_before_max_check_and_sorts_by_option_order(self):
        r = self.submit(areas=["외국어", "외국어", "직무 전문성", "외국어", "직무 전문성"])
        self.assertEqual(r.status, 201)
        self.assertEqual(self.stored("E001")["교육 분야"], "직무 전문성, 외국어")

    def test_areas_invalid(self):
        msg = "교육 분야 값이 올바르지 않습니다."
        for bad in (["없는분야"], "외국어", {"외국어": 1}, ["외국어", 1], [["외국어"]]):
            self.assertEqual(self.assert_rejected(valid_payload(areas=bad)), msg, bad)

    def test_methods(self):
        self.assertEqual(self.assert_rejected(valid_payload(methods=[])), "선호 교육 방식을(를) 1개 이상 선택해 주세요.")
        self.assertEqual(self.assert_rejected(valid_payload(methods=None)), "선호 교육 방식을(를) 1개 이상 선택해 주세요.")
        self.assertEqual(self.assert_rejected(valid_payload(methods=["x"])), "선호 교육 방식 값이 올바르지 않습니다.")
        self.assertEqual(self.assert_rejected(valid_payload(methods="외부 위탁")), "선호 교육 방식 값이 올바르지 않습니다.")
        all5 = ["외부 위탁", "사내 멘토링·스터디", "녹화 강의(이러닝)", "실시간 온라인", "오프라인 집합"]
        self.assertEqual(self.submit(methods=all5).status, 201)  # no max
        self.assertEqual(self.stored("E001")["선호 교육 방식"],
                         "오프라인 집합, 실시간 온라인, 녹화 강의(이러닝), 사내 멘토링·스터디, 외부 위탁")

    def test_barriers(self):
        self.assertEqual(self.submit(barriers=[]).status, 201)
        self.assertEqual(self.submit(barriers=None).status, 200)
        self.assertEqual(self.assert_rejected(valid_payload(barriers=["x"])), "어려운 점 값이 올바르지 않습니다.")
        self.assertEqual(self.assert_rejected(valid_payload(barriers="업무 부담")), "어려운 점 값이 올바르지 않습니다.")
        all4 = ["교육 정보 부족", "원하는 주제 없음", "시간 부족", "업무 부담", "업무 부담"]
        self.assertEqual(self.submit(barriers=all4).status, 200)
        self.assertEqual(self.stored("E001")["어려운 점"], "업무 부담, 시간 부족, 원하는 주제 없음, 교육 정보 부족")


class TestOtherFields(SurveyTestCase):
    def test_area_other_required_when_gita_selected(self):
        msg = "기타 교육 분야 내용을 입력해 주세요."
        self.assertEqual(self.assert_rejected(valid_payload(areas=["기타"], area_other="")), msg)
        self.assertEqual(self.assert_rejected(valid_payload(areas=["기타"], area_other="   ")), msg)
        p = valid_payload(areas=["기타"])
        del p["area_other"]
        self.assertEqual(self.assert_rejected(p), msg)

    def test_area_other_blanked_when_gita_not_selected(self):
        self.assertEqual(self.submit(areas=["외국어"], area_other="남는 값").status, 201)
        self.assertEqual(self.stored("E001")["기타 분야"], "")

    def test_barrier_other_required_when_gita_selected(self):
        msg = "기타 어려운 점 내용을 입력해 주세요."
        self.assertEqual(self.assert_rejected(valid_payload(barriers=["기타"], barrier_other="")), msg)
        self.assertEqual(self.assert_rejected(valid_payload(barriers=["기타"], barrier_other=" ")), msg)

    def test_barrier_other_blanked_when_gita_not_selected(self):
        self.assertEqual(self.submit(barriers=["업무 부담"], barrier_other="남는 값").status, 201)
        self.assertEqual(self.stored("E001")["기타 어려운 점"], "")

    def test_quirk_other_length_checked_even_when_gita_not_selected(self):
        # Length is validated before the value is discarded.
        self.assertEqual(self.assert_rejected(valid_payload(areas=["외국어"], area_other="x" * 101)),
                         "기타 교육 분야은(는) 100자 이내로 입력해 주세요.")
        self.assertEqual(self.assert_rejected(valid_payload(barriers=[], barrier_other="x" * 101)),
                         "기타 어려운 점은(는) 100자 이내로 입력해 주세요.")


class TestSkillAndPastSat(SurveyTestCase):
    def test_skill_range(self):
        for v in (1, 2, 3, 4, 5, "1", "5", " 3 "):
            self.assertIn(self.submit(skill=v).status, (200, 201), v)
        rng = "직무 역량 자기평가은(는) 1~5 사이여야 합니다."
        for v in (0, 6, -1, "0", "6", 100):
            self.assertEqual(self.assert_rejected(valid_payload(skill=v)), rng, v)
        sel = "직무 역량 자기평가을(를) 선택해 주세요."
        for v in (None, "", "abc", "3.5", [3], {}):
            self.assertEqual(self.assert_rejected(valid_payload(skill=v)), sel, v)
        p = valid_payload()
        del p["skill"]
        self.assertEqual(self.assert_rejected(p), sel)

    def test_past_sat_values(self):
        cookie = self.login()
        expect = [("", ""), (None, ""), ("none", "받은 적 없음"),
                  (1, "1"), ("2", "2"), (3, "3"), ("4", "4"), (5, "5")]
        for i, (v, shown) in enumerate(expect):
            self.assertEqual(self.submit(emp_no=f"P{i}", past_sat=v).status, 201, v)
            self.assertEqual(self.stored(f"P{i}", cookie)["지난 1년 교육 만족도"], shown, v)
        p = valid_payload(emp_no="PX")
        del p["past_sat"]
        self.assertEqual(self.post("/api/responses", p).status, 201)
        self.assertEqual(self.stored("PX", cookie)["지난 1년 교육 만족도"], "")

    def test_past_sat_invalid(self):
        rng = "지난 1년 교육 만족도은(는) 1~5 사이여야 합니다."
        for v in (0, "0", 6, -1):
            self.assertEqual(self.assert_rejected(valid_payload(past_sat=v)), rng, v)
        sel = "지난 1년 교육 만족도을(를) 선택해 주세요."
        for v in ("None", "NONE", "abc", " ", [1], {}):
            self.assertEqual(self.assert_rejected(valid_payload(past_sat=v)), sel, v)


class TestQuirks(SurveyTestCase):
    """Known quirks (docs 'Gotchas'). A refactor that changes these must do so on purpose."""

    def test_quirk_int_accepts_true(self):
        # _int uses int(): JSON true -> 1
        self.assertEqual(self.submit(skill=True, past_sat=True).status, 201)
        row = self.stored("E001")
        self.assertEqual(row["역량 자기평가"], "1")
        self.assertEqual(row["지난 1년 교육 만족도"], "1")

    def test_quirk_int_false_is_out_of_range(self):
        self.assertEqual(self.assert_rejected(valid_payload(skill=False)),
                         "직무 역량 자기평가은(는) 1~5 사이여야 합니다.")

    def test_quirk_int_truncates_floats(self):
        # JSON floats are truncated toward zero by int(): 4.9 -> 4, 5.99 -> 5, 0.5 -> 0 (rejected)
        self.assertEqual(self.submit(skill=4.9, past_sat=5.99).status, 201)
        row = self.stored("E001")
        self.assertEqual(row["역량 자기평가"], "4")
        self.assertEqual(row["지난 1년 교육 만족도"], "5")
        self.assertEqual(self.assert_rejected(valid_payload(skill=0.5)),
                         "직무 역량 자기평가은(는) 1~5 사이여야 합니다.")

    def test_quirk_float_string_rejected(self):
        self.assertEqual(self.assert_rejected(valid_payload(skill="4.0")), "직무 역량 자기평가을(를) 선택해 주세요.")

    def test_quirk_text_fields_accept_non_strings(self):
        # _text uses str(value): numbers become text
        self.assertEqual(self.submit(name=123, emp_no=456, dept=7.5).status, 201)
        row = self.stored("456")
        self.assertEqual(row["이름"], "123")
        self.assertEqual(row["부서"], "7.5")

    def test_quirk_falsy_text_values_count_as_empty(self):
        # `data.get(key) or ""`: 0 / false / [] become "" -> required error
        for v in (0, False, []):
            self.assertEqual(self.assert_rejected(valid_payload(name=v)), "이름을(를) 입력해 주세요.", v)

    def test_quirk_text_list_value_is_stringified(self):
        self.assertEqual(self.submit(name=["a"]).status, 201)
        self.assertEqual(self.stored("E001")["이름"], "['a']")

    def test_quirk_emp_no_pattern_checked_after_other_fields(self):
        # emp_no pattern error only appears after every field in the dict has been validated
        self.assertEqual(self.assert_rejected(valid_payload(emp_no="bad no", rank="x")),
                         "직급을(를) 선택해 주세요.")
        # past_sat / 기타 checks come after the emp_no pattern check
        self.assertEqual(self.assert_rejected(valid_payload(emp_no="bad no", past_sat=9)),
                         "사번은 영문·숫자·하이픈(-)만 20자 이내로 입력해 주세요.")

    def test_quirk_validation_order(self):
        # first failing field (in dict order) wins
        p = valid_payload(name="", emp_no="", dept="", rank="x", areas=[], skill=0, methods=[])
        self.assertEqual(self.assert_rejected(p), "이름을(를) 입력해 주세요.")
        p = valid_payload(skill=0, past_sat=9, areas=["기타"], area_other="")
        self.assertEqual(self.assert_rejected(p), "직무 역량 자기평가은(는) 1~5 사이여야 합니다.")
        p = valid_payload(past_sat=9, areas=["기타"], area_other="")
        self.assertEqual(self.assert_rejected(p), "지난 1년 교육 만족도은(는) 1~5 사이여야 합니다.")
        p = valid_payload(areas=["기타"], area_other="", barriers=["기타"], barrier_other="")
        self.assertEqual(self.assert_rejected(p), "기타 교육 분야 내용을 입력해 주세요.")

    def test_quirk_unknown_fields_ignored(self):
        self.assertEqual(self.submit(extra="x", created_at="1999-01-01 00:00:00").status, 201)
        self.assertNotEqual(self.stored("E001")["최초 제출"], "1999-01-01 00:00:00")

    def test_quirk_anyone_can_overwrite_by_emp_no(self):
        self.assertEqual(self.submit(name="본인").status, 201)
        self.assertEqual(self.submit(name="남").status, 200)
        self.assertEqual(self.stored("E001")["이름"], "남")
