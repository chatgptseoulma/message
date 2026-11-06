// Characterization tests for 타인/부동산갈아타기.html ("우리집 NEXT").
// Data is synthetic and seeded (build(2033)), but trade dates are relative to
// "now", so the clock and the timezone are pinned for determinism.
process.env.TZ = "Asia/Seoul";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadApp, appPath } from "./helpers/html-harness.js";

const FILE = appPath("타인", "부동산갈아타기.html");
const KEY = "home_next_plan_v1";
const NOW = new Date("2026-11-05T08:00:00+09:00");

const open = (opts = {}) => loadApp(FILE, { now: NOW, ...opts });
const done = (app) => { assert.deepEqual(app.errors.map((e) => e.message), []); app.close(); };
const t = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : null);
const rows = (app) => [...app.document.querySelectorAll("#list .row")];
const names = (app) => rows(app).map((r) => t(r.querySelector(".nm b")));
const rowData = (r) => {
  const c = r.children;
  return [t(c[1].querySelector("b")), t(c[1].querySelector("span")), t(c[2].querySelector("b")), t(c[2].querySelector("span")),
    t(c[3].querySelector("b")), t(c[3].querySelector("span")), t(c[4].querySelector("b")), t(c[4].querySelector("span")), t(c[5])].join("|");
};
const btn = (app, label) => {
  const b = [...app.document.querySelectorAll("button")].find((x) => x.textContent.includes(label));
  if (!b) throw new Error("button not found: " + label);
  return b;
};
const resList = (app) => [...app.document.querySelectorAll("#rList li")].map((li) => [...li.children].map(t));
const areaBtn = (app, seg, a) => app.document.querySelector(`#${seg} button[data-a="${a}"]`);

const DEFAULT_ROWS = [
  "수내푸른|분당 · 3,730세대 · 1988년|10.14|5건 평균|10.48|2026.10.06|—|거래 부족|-0.07 0.99배",
  "주공그린|과천 · 1,288세대 · 1990년|10.47|9건 평균|10.61|2026.09.12|—|거래 부족|+0.26 1.03배",
  "정자파크뷰|분당 · 3,458세대 · 2005년|11.40|6건 평균|11.52|2026.09.23|—|거래 부족|+1.18 1.12배",
  "중앙자이|과천 · 1,299세대 · 1992년|11.43|10건 평균|11.44|2026.11.02|11.55|7건|+1.22 1.12배",
  "고덕스카이|강동 · 1,717세대 · 1994년|11.56|10건 평균|11.51|2026.11.01|11.60|6건|+1.34 1.13배",
  "암사한강|강동 · 3,200세대 · 2000년|11.89|10건 평균|12.43|2026.10.09|—|거래 부족|+1.68 1.16배",
  "서현시범|분당 · 1,245세대 · 2023년|12.61|10건 평균|12.83|2026.11.04|12.83|3건|+2.40 1.24배",
  "이촌한강|마포·용산 · 1,765세대 · 1994년|12.95|10건 평균|13.12|2026.10.29|13.07|6건|+2.74 1.27배",
  "야탑한양|분당 · 3,295세대 · 1997년|13.18|10건 평균|13.73|2026.11.04|13.29|10건|+2.96 1.29배",
  "과천센트럴|과천 · 1,447세대 · 1989년|13.21|10건 평균|13.03|2026.10.24|13.18|5건|+3.00 1.29배",
  "판교마을|분당 · 1,880세대 · 2016년|13.65|7건 평균|13.90|2026.10.31|13.59|4건|+3.43 1.34배",
  "용산파크|마포·용산 · 618세대 · 1991년|13.70|4건 평균|13.83|2026.10.17|—|거래 부족|+3.48 1.34배",
  "별양푸르지오|과천 · 429세대 · 2018년|14.20|4건 평균|14.51|2026.10.03|—|거래 부족|+3.99 1.39배",
  "파크힐스송파|송파 · 3,564세대 · 2018년|14.23|10건 평균|14.48|2026.10.16|14.41|5건|+4.02 1.39배",
  "마포리버|마포·용산 · 4,400세대 · 1993년|15.94|10건 평균|16.01|2026.10.19|15.65|3건|+5.73 1.56배",
  "올림픽타운|송파 · 3,463세대 · 1993년|15.96|10건 평균|16.27|2026.10.19|15.96|6건|+5.75 1.56배",
  "공덕래미안|마포·용산 · 3,692세대 · 1998년|16.09|10건 평균|16.47|2026.10.22|16.09|8건|+5.88 1.58배",
  "문정래미안|송파 · 3,462세대 · 1994년|16.14|4건 평균|16.83|2026.07.11|—|거래 부족|+5.93 1.58배",
  "가락그린|송파 · 2,033세대 · 2014년|18.71|10건 평균|18.45|2026.10.30|19.21|3건|+8.49 1.83배",
  "은마파크|강남 · 3,610세대 · 2016년|18.96|10건 평균|19.80|2026.11.05|19.03|9건|+8.75 1.86배",
  "개포프레지던스|강남 · 2,740세대 · 1997년|23.35|10건 평균|23.74|2026.08.02|—|거래 부족|+13.13 2.29배",
  "도곡힐스|강남 · 2,167세대 · 2003년|23.42|10건 평균|24.07|2026.11.03|23.23|4건|+13.21 2.29배",
  "대치센트럴|강남 · 657세대 · 2023년|23.47|4건 평균|23.73|2026.08.10|—|거래 부족|+13.26 2.30배",
  "잠실리버뷰|송파 · 894세대 · 2010년|—|거래 부족 · 2건|18.47|2026.08.23|—|거래 부족|—",
  "길동더샵|강동 · 1,754세대 · 1991년|—|거래 부족 · 2건|12.70|2026.03.20|—|거래 부족|—",
  "강동팰리스|강동 · 1,653세대 · 2004년|—|거래 부족 · 2건|11.44|2026.06.11|—|거래 부족|—",
];
const HOME_AVG = 10.21; // 한강자이 59㎡ avg10 (snapshot)

// Independent model of calc().
function model(P, now = NOW) {
  let months = 0;
  if (P.date) { const [y, m] = P.date.split("-").map(Number); months = Math.max(0, (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth())); }
  const bonuses = Math.floor(months / 12);
  const sav = (P.mon * months + P.bonus * bonuses) / 10000;
  const net = P.sale - P.loan - P.fam - P.cgt;
  const equity = net + P.fin + sav, total = equity + P.new;
  const need = P.price + P.acq + P.etc, lack = need - total;
  return { months, bonuses, sav, net, equity, total, need, lack };
}
function assertCalc(app, P) {
  const m = model(P);
  assert.deepEqual(resList(app), [
    ["매도 후 순자금", m.net.toFixed(2) + "억"], ["금융자산", P.fin.toFixed(2) + "억"], ["추가 저축 + 성과급", m.sav.toFixed(2) + "억"],
    ["예상 자기자본", m.equity.toFixed(2) + "억"], ["+ 신규 주담대", P.new.toFixed(2) + "억"], ["총 조달 가능액", m.total.toFixed(2) + "억"],
    ["목표 매수가 + 비용", m.need.toFixed(2) + "억"]]);
  if (m.lack > 0) assert.equal(t(app.$("rNeed")), m.lack.toFixed(2) + " 억원");
  else assert.equal(t(app.$("rNeed")), "충분");
  const msg = `오늘부터 ${m.months}개월 저축 + 성과급 ${m.bonuses}회. 월 저축은 다음 달부터, 성과급은 12개월마다 1회 적립합니다.` +
    (m.lack <= 0 ? ` 목표 대비 ${(-m.lack).toFixed(2)}억 여유가 있습니다.` : "");
  assert.equal(app.$("rMsg").textContent, msg);
  return m;
}
function fillPlan(app, v) {
  if (v.target != null) app.setValue("p_target", v.target);
  for (const k of ["sale", "loan", "fam", "fin", "mon", "bonus", "new", "price", "acq", "cgt", "etc"]) if (v[k] != null) app.setValue("p_" + k, v[k]);
  if (v.date !== undefined) app.setValue("p_date", v.date ?? "");
}

describe("realestate: initial render", () => {
  test("header, home card, stats", () => {
    const app = open();
    assert.equal(app.$("today").textContent, "2026. 11. 05.");
    assert.ok(app.$("upd").textContent.startsWith("갱신 2026. 11. 5."));
    assert.equal(app.$("hName").textContent, "한강자이 전용 59㎡급");
    assert.equal(app.$("hYear").textContent, "2017년 건축 · 9년 경과");
    assert.equal(app.$("hPrice").textContent, "10.21");
    assert.equal(app.$("hMeta").textContent, "최근 10건 평균 · 2026.03.04 ~ 2026.09.21");
    assert.equal(app.$("hBuy").textContent, "최초 매수가 11.20억 · 현재 -0.99억");
    assert.equal(t(app.$("sCount")), "23 / 26개");
    assert.equal(app.$("sGap").textContent, "-0.07억");
    assert.equal(app.$("sGapN").textContent, "수내푸른 · 전용 84㎡급");
    assert.deepEqual([...app.$("region").options].map((o) => o.value), ["전체", "강남", "송파", "강동", "과천", "분당", "마포·용산"]);
    assert.equal(app.$("homeSel").options.length, 27);
    assert.equal(app.$("homeSel").value, "0");
    assert.equal(app.$("homeSel").options[22].textContent, "분당 · 수내푸른");
    assert.equal(areaBtn(app, "homeArea", 59).className, "on");
    assert.equal(areaBtn(app, "areaSeg", 84).className, "on");
    done(app);
  });

  test("buy price input updates the home card", () => {
    const app = open();
    app.setValue("buyPrice", 9.5);
    assert.equal(app.$("hBuy").textContent, `최초 매수가 9.50억 · 현재 +${(HOME_AVG - 9.5).toFixed(2)}억`);
    done(app);
  });

  test("monitor list snapshot for default settings (84㎡, avg10, gap sort)", () => {
    const app = open();
    assert.deepEqual(rows(app).map(rowData), DEFAULT_ROWS);
    assert.deepEqual(rows(app).map((r) => t(r.querySelector(".rk"))), DEFAULT_ROWS.map((_, i) => String(i + 1).padStart(2, "0")));
    assert.ok(!names(app).includes("한강자이"), "home excluded");
    // negative gap rows get .neg
    assert.ok(rows(app)[0].querySelector(".gap").classList.contains("neg"));
    assert.ok(!rows(app)[1].querySelector(".gap").classList.contains("neg"));
    done(app);
  });

  test("quirk: desktop .row grid has 6 columns but each row has 7 children", () => {
    // Known layout bug: the trailing ↗ cell wraps on desktop.
    const app = open();
    for (const r of rows(app)) { assert.equal(r.children.length, 7); assert.equal(r.lastElementChild.textContent, "↗"); }
    assert.equal(app.document.querySelector(".row.head").children.length, 7);
    done(app);
  });
});

describe("realestate: filters", () => {
  test("gap sort: |gap| non-decreasing, rows without price last; ratio = price/base", () => {
    const app = open();
    const gaps = rows(app).map((r) => t(r.querySelector(".gap b")));
    const known = gaps.filter(Boolean).map(Number);
    for (let i = 1; i < known.length; i++) assert.ok(Math.abs(known[i]) >= Math.abs(known[i - 1]));
    assert.deepEqual(gaps.slice(known.length), [null, null, null]);
    done(app);
  });

  test("metric: last / med6 / med3", () => {
    const app = open();
    app.setValue("metric", "last");
    assert.deepEqual(rows(app).slice(0, 5).map(rowData), [
      "수내푸른|분당 · 3,730세대 · 1988년|10.48|기준 지표|10.48|2026.10.06|—|거래 부족|+0.27 1.03배",
      "주공그린|과천 · 1,288세대 · 1990년|10.61|기준 지표|10.61|2026.09.12|—|거래 부족|+0.40 1.04배",
      "강동팰리스|강동 · 1,653세대 · 2004년|11.44|기준 지표|11.44|2026.06.11|—|거래 부족|+1.23 1.12배",
      "중앙자이|과천 · 1,299세대 · 1992년|11.44|기준 지표|11.44|2026.11.02|11.55|7건|+1.23 1.12배",
      "고덕스카이|강동 · 1,717세대 · 1994년|11.51|기준 지표|11.51|2026.11.01|11.60|6건|+1.30 1.13배"]);
    assert.equal(t(app.$("sCount")), "26 / 26개");
    // with metric=last the selected price equals the "최근 거래 1건" column
    for (const r of rows(app)) assert.equal(t(r.children[2].querySelector("b")), t(r.children[3].querySelector("b")));
    app.setValue("metric", "med6");
    assert.deepEqual(rows(app).slice(0, 3).map(rowData), [
      "주공그린|과천 · 1,288세대 · 1990년|10.47|기준 지표|10.61|2026.09.12|—|거래 부족|+0.26 1.03배",
      "중앙자이|과천 · 1,299세대 · 1992년|11.41|기준 지표|11.44|2026.11.02|11.55|7건|+1.20 1.12배",
      "정자파크뷰|분당 · 3,458세대 · 2005년|11.52|기준 지표|11.52|2026.09.23|—|거래 부족|+1.31 1.13배"]);
    assert.equal(t(app.$("sCount")), "21 / 26개");
    app.setValue("metric", "med3");
    assert.equal(t(app.$("sCount")), "14 / 26개");
    assert.equal(app.$("sGap").textContent, "+1.34억");
    assert.equal(app.$("sGapN").textContent, "중앙자이 · 전용 84㎡급");
    // med3 price column equals the 3개월 중앙값 column
    for (const r of rows(app)) assert.equal(t(r.children[2].querySelector("b")), t(r.children[4].querySelector("b")));
    done(app);
  });

  test("sort by name and by latest trade date", () => {
    const app = open();
    app.setValue("sort", "name");
    const n = names(app);
    assert.deepEqual(n, [...n].sort((a, b) => a.localeCompare(b, "ko")));
    assert.equal(n[0], "가락그린");
    app.setValue("sort", "date");
    assert.deepEqual(names(app), ["은마파크", "서현시범", "야탑한양", "도곡힐스", "중앙자이", "고덕스카이", "판교마을", "가락그린", "이촌한강", "과천센트럴", "공덕래미안", "올림픽타운", "마포리버", "용산파크", "파크힐스송파", "암사한강", "수내푸른", "별양푸르지오", "정자파크뷰", "주공그린", "잠실리버뷰", "대치센트럴", "개포프레지던스", "문정래미안", "강동팰리스", "길동더샵"]);
    const dates = rows(app).map((r) => t(r.children[3].querySelector("span")));
    for (let i = 1; i < dates.length; i++) assert.ok(dates[i] <= dates[i - 1]);
    done(app);
  });

  test("region and search filters; empty result", () => {
    const app = open();
    app.setValue("region", "강남");
    assert.deepEqual(names(app), ["은마파크", "개포프레지던스", "도곡힐스", "대치센트럴"]);
    assert.equal(t(app.$("sCount")), "4 / 4개");
    app.setValue("region", "전체");
    app.setValue("q", "센트럴");
    assert.deepEqual(names(app), ["과천센트럴", "대치센트럴"]);
    assert.equal(t(app.$("sCount")), "2 / 2개");
    app.setValue("q", "  센트럴  "); // trimmed
    assert.equal(names(app).length, 2);
    app.setValue("region", "분당");
    assert.equal(t(app.$("list")), "조건에 맞는 단지가 없습니다.");
    assert.equal(t(app.$("sCount")), "0 / 0개");
    assert.equal(app.$("sGap").textContent, "—");
    assert.equal(app.$("sGapN").textContent, "비교 가능한 단지 없음");
    done(app);
  });

  test("comparison area segment 59 / 74", () => {
    const app = open();
    app.click(areaBtn(app, "areaSeg", 59));
    assert.equal(areaBtn(app, "areaSeg", 59).className, "on");
    assert.equal(areaBtn(app, "areaSeg", 84).className, "");
    assert.equal(t(app.$("sCount")), "22 / 26개");
    assert.equal(app.$("sGap").textContent, "+0.17억");
    assert.equal(app.$("sGapN").textContent, "마포리버 · 전용 59㎡급");
    assert.deepEqual(names(app).slice(0, 5), ["마포리버", "공덕래미안", "올림픽타운", "문정래미안", "별양푸르지오"]);
    app.click(areaBtn(app, "areaSeg", 74));
    assert.equal(t(app.$("sCount")), "24 / 26개");
    assert.equal(app.$("sGapN").textContent, "서현시범 · 전용 74㎡급");
    assert.deepEqual(names(app).slice(0, 5), ["서현시범", "정자파크뷰", "야탑한양", "암사한강", "길동더샵"]);
    done(app);
  });

  test("quirk: changing comparison area does not reset the plan's target price", () => {
    // Known bug: syncPrice only fills nulls, so P.price stays at the 84㎡ value.
    const app = open();
    app.click(areaBtn(app, "areaSeg", 59));
    assert.equal(app.$("p_price").value, "23.47");
    assert.equal(app.$("rSub").textContent, "강남 · 59㎡급 · 2033-11 매수 가정");
    done(app);
  });

  test("home selection and home area change the base", () => {
    const app = open();
    app.click(areaBtn(app, "homeArea", 84));
    assert.equal(app.$("hName").textContent, "한강자이 전용 84㎡급");
    assert.notEqual(app.$("hPrice").textContent, "10.21");
    app.click(areaBtn(app, "homeArea", 59));
    app.setValue("homeSel", 22);
    assert.equal(app.$("hName").textContent, "수내푸른 전용 59㎡급");
    assert.ok(!names(app).includes("수내푸른"));
    assert.ok(names(app).includes("한강자이"));
    assert.equal(app.$("p_sale").value, app.$("hPrice").textContent.replace(/0+$/, "").replace(/\.$/, ""));
    done(app);
  });

  test("quirk: home with fewer than 3 trades -> every gap is — and sale price becomes 0", () => {
    // Known bug #4.
    const app = open();
    app.setValue("homeSel", 11); // 암사한강 has <3 trades at 59㎡
    assert.equal(app.$("hPrice").textContent, "—");
    assert.equal(app.$("hMeta").textContent, "거래 부족");
    assert.equal(app.$("hBuy").textContent, "최초 매수가 11.20억");
    assert.ok(rows(app).every((r) => t(r.querySelector(".gap")) === "—"));
    assert.equal(t(app.$("sCount")), "0 / 26개");
    assert.equal(app.$("p_sale").value, "0");
    assert.equal(resList(app)[0][1], "0.00억");
    done(app);
  });
});

describe("realestate: detail panel", () => {
  test("row click opens detail with chart and 10-trade table; second click closes", () => {
    const app = open();
    const row = rows(app).find((r) => r.textContent.includes("중앙자이"));
    app.click(row);
    const det = app.document.querySelectorAll("#list .detail");
    assert.equal(det.length, 1);
    const d = det[0];
    assert.equal(d.previousElementSibling.querySelector(".nm b").textContent, "중앙자이");
    assert.equal(t(d.querySelector(".eyebrow")), "과천");
    assert.equal(t(d.querySelector("h3")), "중앙자이 전용 84㎡급 · 1992년 건축");
    assert.deepEqual([...d.querySelectorAll(".kv b")].map(t), ["11.43억", "+1.22억", "10 / 10건"]);
    const trs = [...d.querySelectorAll("table tr")];
    assert.deepEqual(trs[0].textContent, "계약일층유형가격");
    assert.deepEqual(trs.slice(1).map((tr) => [...tr.children].map(t).join("|")), [
      "2026.11.02|15층|중개거래|11.44억", "2026.10.24|18층|중개거래|12.09억", "2026.10.13|20층|중개거래|11.92억",
      "2026.10.10|17층|중개거래|11.55억", "2026.10.09|14층|중개거래|11.70억", "2026.08.28|18층|중개거래|11.10억",
      "2026.08.26|6층|중개거래|11.16억", "2026.07.26|24층|중개거래|11.06억", "2026.07.22|14층|중개거래|10.98억",
      "2026.06.02|3층|중개거래|11.30억"]);
    const svg = d.querySelector("svg");
    assert.ok(svg);
    assert.equal(svg.getAttribute("viewBox"), "0 0 420 190");
    assert.equal(svg.querySelectorAll("circle").length, 10);
    assert.deepEqual([...svg.querySelectorAll("text")].map(t), ["10.4", "11.0", "11.7", "12.3", "25.12", "26.03", "26.06", "26.09", "26.11"]);
    assert.ok(svg.querySelector("path").getAttribute("d").startsWith("M"));
    // clicking inside the detail does not toggle it
    app.click(d.querySelector(".kv"));
    assert.equal(app.document.querySelectorAll("#list .detail").length, 1);
    app.click(rows(app).find((r) => r.textContent.includes("중앙자이")));
    assert.equal(app.document.querySelectorAll("#list .detail").length, 0);
    done(app);
  });

  test("opening another row moves the single detail panel", () => {
    const app = open();
    app.click(rows(app)[0]);
    app.click(rows(app)[4]);
    const det = app.document.querySelectorAll("#list .detail");
    assert.equal(det.length, 1);
    assert.equal(det[0].previousElementSibling.querySelector(".nm b").textContent, "고덕스카이");
    done(app);
  });

  test("detail for a complex with few trades", () => {
    const app = open();
    app.click(rows(app).find((r) => r.textContent.includes("잠실리버뷰")));
    const d = app.document.querySelector("#list .detail");
    assert.deepEqual([...d.querySelectorAll(".kv b")].map(t), ["—억", "—", "2 / 10건"]);
    assert.equal(d.querySelectorAll("table tr").length, 3);
    done(app);
  });

  test("planFor sets target, fills price from avg10 and recalculates (not saved until next input)", () => {
    const app = open();
    app.setValue("p_loan", 2);
    const before = app.storage.get(KEY);
    app.click(rows(app).find((r) => r.textContent.includes("중앙자이")));
    app.click(btn(app, "이 단지로 자금 계획하기"));
    assert.equal(app.$("p_target").value, "17");
    assert.equal(app.$("p_price").value, "11.43");
    assert.equal(app.$("p_loan").value, "2");
    assert.equal(app.$("rName").textContent, "중앙자이");
    assert.equal(app.$("rSub").textContent, "과천 · 84㎡급 · 2033-11 매수 가정");
    assertCalc(app, { sale: 10.21, loan: 2, fam: 0, fin: 0, mon: 0, bonus: 0, date: "2033-11", new: 0, price: 11.43, acq: 0, cgt: 0, etc: 0 });
    assert.deepEqual(app.storage.get(KEY), before);
    app.setValue("p_fin", 1);
    assert.equal(app.storage.get(KEY).target, 17);
    assert.equal(app.storage.get(KEY).price, 11.43);
    done(app);
  });

  test("3D visit without three.js shows the fallback message; close via button and Escape", () => {
    // three.js comes from a CDN that jsdom does not load -> THREE undefined.
    const app = open();
    app.click(rows(app).find((r) => r.textContent.includes("중앙자이")));
    app.click(btn(app, "임장 가기 (3D)"));
    assert.equal(app.$("v3").hidden, false);
    assert.equal(app.$("v3t").textContent, "중앙자이 임장 가기");
    assert.equal(app.$("v3s").textContent, "과천 · 1,299세대 · 1992년 건축");
    assert.equal(app.$("v3msg").textContent, "3D 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.");
    app.click(btn(app, "닫기"));
    assert.equal(app.$("v3").hidden, true);
    app.click(btn(app, "임장 가기 (3D)"));
    app.window.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Escape" }));
    assert.equal(app.$("v3").hidden, true);
    done(app);
  });
});

describe("realestate: funding calculator", () => {
  test("default plan values and result", () => {
    const app = open();
    const vals = Object.fromEntries(["sale", "loan", "fam", "fin", "mon", "bonus", "date", "new", "target", "price", "acq", "cgt", "etc"].map((k) => [k, app.$("p_" + k).value]));
    assert.deepEqual(vals, { sale: "10.21", loan: "0", fam: "0", fin: "0", mon: "0", bonus: "0", date: "2033-11", new: "0", target: "1", price: "23.47", acq: "0", cgt: "0", etc: "0" });
    assert.equal(app.$("rName").textContent, "대치센트럴");
    assert.equal(app.$("rSub").textContent, "강남 · 84㎡급 · 2033-11 매수 가정");
    assert.equal(t(app.$("rNeed")), "13.26 억원");
    const m = assertCalc(app, { sale: 10.21, loan: 0, fam: 0, fin: 0, mon: 0, bonus: 0, date: "2033-11", new: 0, price: 23.47, acq: 0, cgt: 0, etc: 0 });
    assert.equal(m.months, 84);
    assert.equal(m.bonuses, 7);
    assert.deepEqual(app.storage.get(KEY), { sale: 10.21, loan: 0, fam: 0, fin: 0, mon: 0, bonus: 0, date: "2033-11", new: 0, target: 1, price: 23.47, acq: 0, cgt: 0, etc: 0 });
    done(app);
  });

  const cases = [
    ["shortfall case", { target: 4, sale: 12, loan: 3, fam: 0.5, fin: 2, mon: 300, bonus: 1000, date: "2029-05", new: 6, price: 20, acq: 0.66, cgt: 0.2, etc: 0.1 }],
    ["enough case with surplus message", { target: 10, sale: 15, loan: 1, fam: 0, fin: 3, mon: 500, bonus: 2000, date: "2031-12", new: 5, price: 18, acq: 0.59, cgt: 0.4, etc: 0.05 }],
    ["past date -> 0 months", { target: 2, sale: 9, loan: 4, fam: 1, fin: 0.5, mon: 200, bonus: 500, date: "2025-01", new: 4, price: 13, acq: 0.3, cgt: 0, etc: 0 }],
    ["same month -> 0 months, next month -> 1", { target: 2, sale: 9, loan: 0, fam: 0, fin: 0, mon: 100, bonus: 0, date: "2026-12", new: 0, price: 9, acq: 0, cgt: 0, etc: 0 }],
  ];
  for (const [name, v] of cases) {
    test(`calc: ${name}`, () => {
      const app = open();
      fillPlan(app, v);
      const P = { ...v };
      const m = assertCalc(app, P);
      if (name.startsWith("shortfall")) { assert.equal(m.months, 30); assert.equal(m.bonuses, 2); assert.equal(t(app.$("rNeed")), "3.36 억원"); }
      if (name.startsWith("enough")) assert.equal(t(app.$("rNeed")), "충분");
      if (name.startsWith("past")) assert.equal(m.months, 0);
      if (name.startsWith("same")) assert.equal(m.months, 1);
      assert.equal(app.$("rSub").textContent.endsWith(`· 84㎡급 · ${v.date} 매수 가정`), true);
      const saved = app.storage.get(KEY);
      for (const k of Object.keys(v)) assert.equal(saved[k], v[k], k);
      done(app);
    });
  }

  test("changing the target select resets price to the new complex's avg10", () => {
    const app = open();
    app.setValue("p_price", 30);
    app.setValue("p_target", 17);
    assert.equal(app.$("p_price").value, "11.43");
    assert.equal(app.$("rName").textContent, "중앙자이");
    assert.equal(app.storage.get(KEY).price, 11.43);
    done(app);
  });

  test("empty / non-numeric inputs count as 0; empty date -> 매수 시점 미입력", () => {
    const app = open();
    app.setValue("p_sale", "");
    app.setValue("p_date", "");
    assert.equal(app.$("rSub").textContent, "강남 · 84㎡급 · 매수 시점 미입력");
    assertCalc(app, { sale: 0, loan: 0, fam: 0, fin: 0, mon: 0, bonus: 0, date: null, new: 0, price: 23.47, acq: 0, cgt: 0, etc: 0 });
    assert.equal(app.storage.get(KEY).sale, 0);
    assert.equal(app.storage.get(KEY).date, null);
    done(app);
  });

  for (const price of [5, 7.5, 12]) {
    test(`autoAcq at ${price}억`, () => {
      const app = open();
      app.setValue("p_price", price);
      app.click(btn(app, "취득세 일반세율로 자동 입력"));
      const r = price <= 6 ? 1 : price <= 9 ? price * 2 / 3 - 3 : 3;
      const acq = +(price * r / 100 * 1.1).toFixed(2);
      assert.equal(app.$("p_acq").value, String(acq));
      assert.equal(app.storage.get(KEY).acq, acq);
      assertCalc(app, { sale: 10.21, loan: 0, fam: 0, fin: 0, mon: 0, bonus: 0, date: "2033-11", new: 0, price, acq, cgt: 0, etc: 0 });
      done(app);
    });
  }

  test("autoAcq snapshot values", () => {
    const app = open();
    const out = [];
    for (const p of [5, 6, 7.5, 9, 12]) { app.setValue("p_price", p); app.click(btn(app, "취득세 일반세율로 자동 입력")); out.push(app.$("p_acq").value); }
    // Note: 0.055 and 0.165 round UP here because p*r/100*1.1 carries float error
    // (0.05500000000000001, 0.16500000000000004). A refactor computing p*0.011
    // would round 5억 -> 0.05 and change behavior.
    assert.deepEqual(out, ["0.06", "0.07", "0.17", "0.3", "0.4"]);
    done(app);
  });

  test("quirk: guide says education tax is separate, but autoAcq includes ×1.1", () => {
    // Known doc/code mismatch (#7).
    const app = open();
    assert.ok(app.$("guide").textContent.includes("교육세 별도"));
    app.setValue("p_price", 12);
    app.click(btn(app, "취득세 일반세율로 자동 입력"));
    assert.equal(app.$("p_acq").value, "0.4"); // 12×3% = 0.36 without ×1.1
    done(app);
  });

  test("resetPlan keeps target, refills sale/price, zeros others, clears date", () => {
    const app = open();
    fillPlan(app, { target: 17, loan: 3, fin: 2, mon: 300, price: 30, acq: 0.5, date: "2030-01" });
    app.click(btn(app, "입력 초기화"));
    assert.equal(app.$("p_target").value, "17");
    assert.equal(app.$("p_sale").value, "10.21");
    assert.equal(app.$("p_price").value, "11.43");
    for (const k of ["loan", "fam", "fin", "mon", "bonus", "new", "acq", "cgt", "etc"]) assert.equal(app.$("p_" + k).value, "0", k);
    assert.equal(app.$("p_date").value, "");
    assert.equal(app.$("rSub").textContent, "과천 · 84㎡급 · 매수 시점 미입력");
    assert.ok(app.$("rMsg").textContent.startsWith("오늘부터 0개월 저축 + 성과급 0회."));
    assert.deepEqual(app.storage.get(KEY), { sale: 10.21, loan: 0, fam: 0, fin: 0, mon: 0, bonus: 0, date: null, new: 0, target: 17, price: 11.43, acq: 0, cgt: 0, etc: 0 });
    done(app);
  });

  test("quirk: unsupported type=month (text fallback) yields NaN", () => {
    // Known bug #5: browsers without type=month let free text through; split('-') fails.
    const app = open();
    app.$("p_date").type = "text";
    app.setValue("p_date", "2030/01");
    assert.ok(app.$("rMsg").textContent.startsWith("오늘부터 NaN개월 저축 + 성과급 NaN회."));
    assert.equal(resList(app)[2][1], "NaN억");
    done(app);
  });
});

describe("realestate: persistence", () => {
  test("saved plan is restored into inputs and result", () => {
    const saved = { sale: 13.5, loan: 2.5, fam: 0.3, fin: 1.2, mon: 250, bonus: 800, date: "2030-03", new: 5, target: 22, price: 11, acq: 0.12, cgt: 0.15, etc: 0.08 };
    const app = open({ storage: { [KEY]: saved } });
    for (const k of ["sale", "loan", "fam", "fin", "mon", "bonus", "new", "price", "acq", "cgt", "etc"]) assert.equal(app.$("p_" + k).value, String(saved[k]), k);
    assert.equal(app.$("p_date").value, "2030-03");
    assert.equal(app.$("p_target").value, "22");
    assert.equal(app.$("rName").textContent, "수내푸른");
    assertCalc(app, saved);
    assert.deepEqual(app.storage.get(KEY), saved);
    done(app);
  });

  test("partial saved plan: missing date gets +7 years, null sale/price filled from data", () => {
    const app = open({ storage: { [KEY]: { loan: 1, target: 17 } } });
    assert.equal(app.$("p_date").value, "2033-11");
    assert.equal(app.$("p_sale").value, "10.21");
    assert.equal(app.$("p_price").value, "11.43");
    assert.equal(app.$("p_loan").value, "1");
    assert.equal(app.storage.get(KEY).target, 17);
    done(app);
  });

  test("corrupt storage is ignored", () => {
    const app = open({ storage: { [KEY]: "{oops" } });
    assert.equal(app.$("p_target").value, "1");
    assert.equal(app.storage.get(KEY).price, 23.47);
    done(app);
  });

  test("buyPrice, area and filters are not persisted", () => {
    const app = open();
    app.setValue("buyPrice", 8);
    app.click(areaBtn(app, "areaSeg", 59));
    app.setValue("region", "강남");
    const raw = app.storage.raw(KEY);
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["acq", "bonus", "cgt", "date", "etc", "fam", "fin", "loan", "mon", "new", "price", "sale", "target"]);
    app.close();
    const app2 = open({ storage: { [KEY]: raw } });
    assert.equal(app2.$("buyPrice").value, "11.2");
    assert.equal(areaBtn(app2, "areaSeg", 84).className, "on");
    assert.equal(app2.$("region").value, "전체");
    done(app2);
  });
});

describe("realestate: regen (새로고침)", () => {
  test("quirk: regen reseeds from Date.now()%100000 and erases user-entered sale/price", () => {
    // Known bug #3: user prices are overwritten. Other inputs survive.
    const app = open();
    app.setValue("p_sale", 20);
    app.setValue("p_price", 30);
    app.setValue("p_loan", 2);
    app.click(rows(app)[0]);
    app.click(btn(app, "새로고침"));
    // NOW is a whole-hour instant, so seed = 0
    assert.equal(app.$("hPrice").textContent, "11.70");
    assert.equal(app.$("p_sale").value, "11.7");
    assert.equal(app.$("p_price").value, "16.88");
    assert.equal(app.$("p_loan").value, "2");
    assert.equal(app.$("rName").textContent, "대치센트럴");
    assert.deepEqual(names(app).slice(0, 5), ["이촌한강", "암사한강", "수내푸른", "길동더샵", "별양푸르지오"]);
    assert.equal(app.document.querySelectorAll("#list .detail").length, 0, "detail closed");
    assert.ok(app.$("upd").textContent.startsWith("갱신 "));
    // complex names / ids are unchanged, only numbers differ
    assert.equal(app.$("homeSel").options.length, 27);
    assert.equal(app.$("homeSel").value, "0");
    assert.equal(app.$("p_target").value, "1");
    done(app);
  });

  test("regen at a different time gives different data; same time is deterministic", () => {
    const a = open(); a.tick(12345); a.click(btn(a, "새로고침"));
    const b = open(); b.tick(12345); b.click(btn(b, "새로고침"));
    assert.deepEqual(rows(a).map(rowData), rows(b).map(rowData));
    assert.notDeepEqual(rows(a).map(rowData), DEFAULT_ROWS);
    assert.equal(a.$("p_sale").value, String(+Number(a.$("hPrice").textContent).toFixed(2)));
    done(a); done(b);
  });
});
