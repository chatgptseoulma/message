// Characterization tests for C:\2026CC\출근 전 점검표.html ("출근 전 점검표").
// Black-box: DOM ids, checkbox clicks, fake dates, localStorage "commute-checklist-v1".
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp, appPath, submit } from "./helpers/html-harness.js";

const FILE = appPath("출근 전 점검표.html");
const KEY = "commute-checklist-v1";
// Nov 2026: 2=Mon 3=Tue 4=Wed 5=Thu 6=Fri 7=Sat 8=Sun
const MON = new Date(2026, 10, 2, 7, 30);
const TUE = new Date(2026, 10, 3, 7, 30);
const THU = new Date(2026, 10, 5, 8, 0);

const ALL_IDS = ["a1", "a2", "a3", "a4", "a5", "a6", "b1", "b2", "b3", "b4", "b5", "b6", "c1", "c2", "c3"];
const IMP_TEXT = ["휴대폰", "지갑 · 교통카드", "사원증", "가스레인지 불 끄기", "고데기 · 다리미 플러그 뽑기", "현관문 잠김 확인"];

const open = (opts = {}) => loadApp(FILE, { now: THU, ...opts });
const text = (app, id) => app.$(id).textContent;
const itemIds = app => [...app.$("groups").querySelectorAll("input[type=checkbox]")].map(i => i.id.replace(/^chk-/, ""));
const check = (app, id) => app.click("chk-" + id);
const todayIds = wd => ALL_IDS.filter(id => !(id === "a6" && wd !== 1) && !(id === "b6" && wd !== 2 && wd !== 5));
function checkAll(app) { for (const id of itemIds(app)) if (!app.$("chk-" + id).checked && !app.$("chk-" + id).disabled) check(app, id); }
const groupHeads = app => [...app.$("groups").querySelectorAll(".group-head")].map(h => h.textContent);
/** jump the fake clock to a date and let the 15 s clock tick notice */
function goTo(app, date) { app.clock.setSystemTime(date); app.tick(15_000); }

test("fresh Thursday: 13 of 15 default items, pill and summary", () => {
  const app = open();
  assert.deepEqual(itemIds(app), todayIds(4));
  assert.equal(itemIds(app).length, 13);
  assert.equal(text(app, "count"), "0/13");
  assert.equal(text(app, "pill"), "중요 6개 남음");
  assert.equal(text(app, "left"), "아직 안 한 중요 항목: " + IMP_TEXT.join(", "));
  assert.equal(app.$("barFill").style.width, "0%");
  assert.equal(text(app, "streak"), "0일");
  assert.equal(text(app, "lastDone"), "기록 없음");
  assert.equal(text(app, "date"), "11월 5일 목요일");
  assert.equal(text(app, "clock"), "08:00");
  assert.deepEqual(groupHeads(app), ["챙길 것0/5", "집 단속0/5", "나가기 직전0/3"]);
  const skipped = [...app.$("groups").querySelectorAll(".skipped")].map(p => p.textContent);
  assert.deepEqual(skipped, ["오늘은 요일이 맞지 않는 항목 1개를 숨겼습니다.", "오늘은 요일이 맞지 않는 항목 1개를 숨겼습니다."]);
  // important items carry an imp class + tag
  const li = app.$("chk-a1").closest("li");
  assert.ok(li.classList.contains("imp"));
  assert.equal(li.querySelector(".tag.imp").textContent, "중요");
  assert.equal(li.querySelector("strong").textContent, "휴대폰");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("fresh state is persisted with the documented shape", () => {
  const app = open();
  const s = app.storage.get(KEY);
  assert.deepEqual(Object.keys(s).sort(), ["completed", "date", "done", "items", "lastDoneAt"]);
  assert.equal(s.date, "2026-11-05");
  assert.deepEqual(s.done, []);
  assert.deepEqual(s.completed, []);
  assert.equal(s.lastDoneAt, "");
  assert.equal(s.items.length, 15);
  assert.deepEqual(s.items.map(i => i.id), ALL_IDS);
  assert.deepEqual(s.items[5], { id: "a6", group: "bag", text: "주간 보고 자료", days: [1], imp: false });
  assert.deepEqual(s.items[11], { id: "b6", group: "home", text: "음식물 쓰레기 내놓기", days: [2, 5], imp: false });
  assert.deepEqual(s.items[0], { id: "a1", group: "bag", text: "휴대폰", days: [], imp: true });
  assert.deepEqual(s.items.filter(i => i.imp).map(i => i.id), ["a1", "a2", "a3", "b1", "b2", "c3"]);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("weekday filtering: Monday shows 주간 보고, Tuesday shows 음식물 쓰레기", () => {
  const mon = open({ now: MON });
  assert.deepEqual(itemIds(mon), todayIds(1));
  assert.ok(itemIds(mon).includes("a6") && !itemIds(mon).includes("b6"));
  assert.equal(text(mon, "count"), "0/14");
  assert.equal(text(mon, "date"), "11월 2일 월요일");
  assert.equal(mon.$("chk-a6").closest("li").querySelector(".tag").textContent, "월요일만");
  assert.deepEqual(mon.errors, []);
  mon.close();
  const tue = open({ now: TUE });
  assert.deepEqual(itemIds(tue), todayIds(2));
  assert.ok(!itemIds(tue).includes("a6") && itemIds(tue).includes("b6"));
  assert.equal(text(tue, "count"), "0/14");
  assert.equal(tue.$("chk-b6").closest("li").querySelector(".tag").textContent, "화·금요일만");
  assert.deepEqual(tue.errors, []);
  tue.close();
});

test("toggling items updates count, bar, group heads, pill and storage", () => {
  const app = open();
  check(app, "a1");
  assert.equal(app.$("chk-a1").checked, true);
  assert.ok(app.$("chk-a1").closest("li").classList.contains("checked"));
  assert.equal(text(app, "count"), "1/13");
  assert.equal(text(app, "pill"), "중요 5개 남음");
  assert.equal(groupHeads(app)[0], "챙길 것1/5");
  assert.equal(app.$("barFill").style.width, (1 / 13 * 100) + "%");
  assert.deepEqual(app.storage.get(KEY).done, ["a1"]);
  check(app, "a1"); // uncheck
  assert.equal(text(app, "count"), "0/13");
  assert.deepEqual(app.storage.get(KEY).done, []);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("after all important items: pill '점검 중' and remaining list", () => {
  const app = open();
  for (const id of ["a1", "a2", "a3", "b1", "b2", "c3"]) check(app, id);
  assert.equal(text(app, "pill"), "점검 중");
  assert.equal(text(app, "left"), "남은 항목: 집 열쇠, 이어폰 · 충전기, 에어컨 · 난방 끄기, 창문 닫기, 전등 끄기, 날씨 확인 · 우산 챙기기, 오늘 일정 확인");
  assert.equal(app.$("pill").classList.contains("ok"), false);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("all done: departure pill, board done, lastDoneAt, completed, streak 1", () => {
  const app = open();
  checkAll(app);
  assert.equal(text(app, "count"), "13/13");
  assert.equal(text(app, "pill"), "출발해도 됩니다");
  assert.ok(app.$("pill").classList.contains("ok"));
  assert.ok(app.$("board").classList.contains("done"));
  assert.equal(app.$("barFill").style.width, "100%");
  assert.equal(text(app, "left"), "모두 확인했습니다. 08:00에 점검 완료.");
  assert.equal(text(app, "streak"), "1일");
  assert.equal(text(app, "lastDone"), "11/05 08:00");
  const s = app.storage.get(KEY);
  assert.deepEqual(s.completed, ["2026-11-05"]);
  assert.equal(s.lastDoneAt, "2026-11-05 08:00");
  assert.deepEqual([...s.done].sort(), todayIds(4).sort());
  // unchecking one removes today's completion but keeps lastDoneAt
  check(app, "c2");
  assert.equal(text(app, "pill"), "점검 중");
  assert.equal(text(app, "streak"), "0일");
  assert.deepEqual(app.storage.get(KEY).completed, []);
  assert.equal(text(app, "lastDone"), "11/05 08:00");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("midnight rollover clears today's checks but keeps completion history", () => {
  const app = open();
  checkAll(app);
  goTo(app, new Date(2026, 10, 6, 0, 0, 5)); // Friday
  assert.equal(text(app, "date"), "11월 6일 금요일");
  assert.equal(text(app, "count"), "0/14");
  assert.deepEqual(itemIds(app), todayIds(5));
  assert.equal(text(app, "streak"), "1일", "yesterday still counts");
  const s = app.storage.get(KEY);
  assert.equal(s.date, "2026-11-06");
  assert.deepEqual(s.done, []);
  assert.deepEqual(s.completed, ["2026-11-05"]);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("streak over several days and broken by a missed day", () => {
  const app = open({ now: MON });
  checkAll(app);
  assert.equal(text(app, "streak"), "1일");
  goTo(app, new Date(2026, 10, 3, 7, 0)); // Tue
  checkAll(app);
  assert.equal(text(app, "streak"), "2일");
  goTo(app, new Date(2026, 10, 4, 7, 0)); // Wed
  assert.equal(text(app, "streak"), "2일");
  checkAll(app);
  assert.equal(text(app, "streak"), "3일");
  goTo(app, new Date(2026, 10, 6, 7, 0)); // Fri (Thu skipped)
  assert.equal(text(app, "streak"), "0일");
  checkAll(app);
  assert.equal(text(app, "streak"), "1일");
  assert.deepEqual(app.storage.get(KEY).completed, ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-06"]);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("streak is read from a pre-seeded completed list", () => {
  const app = open({
    storage: {
      [KEY]: { items: [{ id: "x", group: "bag", text: "열쇠", days: [], imp: false }], date: "2026-11-04", done: ["x"], completed: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"], lastDoneAt: "2026-11-04 07:41" },
    },
  });
  assert.equal(text(app, "streak"), "4일");
  assert.equal(text(app, "lastDone"), "11/04 07:41");
  assert.equal(text(app, "count"), "0/1", "new day cleared done");
  assert.equal(text(app, "pill"), "점검 중");
  assert.equal(text(app, "left"), "남은 항목: 열쇠");
  assert.equal(app.storage.get(KEY).date, "2026-11-05");
  check(app, "x");
  assert.equal(text(app, "streak"), "5일");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("resetToday clears checks and today's completion", () => {
  const app = open();
  checkAll(app);
  app.click("resetToday");
  assert.equal(text(app, "count"), "0/13");
  assert.equal(text(app, "streak"), "0일");
  const s = app.storage.get(KEY);
  assert.deepEqual(s.done, []);
  assert.deepEqual(s.completed, []);
  assert.equal(s.lastDoneAt, "2026-11-05 08:00", "lastDoneAt kept");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("edit mode shows every item, off-day items disabled, delete buttons", () => {
  const app = open();
  app.click("editToggle");
  assert.equal(app.$("editor").hidden, false);
  assert.equal(text(app, "editToggle"), "편집 끝내기");
  assert.equal(app.$("editToggle").getAttribute("aria-expanded"), "true");
  assert.deepEqual(itemIds(app), ALL_IDS);
  assert.equal(app.$("chk-a6").disabled, true);
  assert.equal(app.$("chk-a6").closest("li").querySelector(".tag").textContent, "월요일만 · 오늘 아님");
  assert.equal(app.$("chk-b6").closest("li").querySelector(".tag").textContent, "화·금요일만 · 오늘 아님");
  assert.equal(app.$("groups").querySelectorAll(".skipped").length, 0);
  const dels = [...app.$("groups").querySelectorAll("button.del")];
  assert.equal(dels.length, 15);
  assert.equal(dels[0].getAttribute("aria-label"), "휴대폰 삭제");
  assert.deepEqual(groupHeads(app), ["챙길 것0/5", "집 단속0/5", "나가기 직전0/3"]);
  assert.equal(text(app, "count"), "0/13", "summary still counts today only");
  // group select and weekday buttons (Mon..Sun)
  assert.deepEqual([...app.$("newGroup").options].map(o => [o.value, o.textContent]), [["bag", "챙길 것"], ["home", "집 단속"], ["out", "나가기 직전"]]);
  assert.deepEqual([...app.$("newDays").querySelectorAll(".day")].map(b => b.textContent), ["월", "화", "수", "목", "금", "토", "일"]);
  app.click("editToggle");
  assert.equal(app.$("editor").hidden, true);
  assert.equal(text(app, "editToggle"), "항목 편집");
  assert.equal(app.$("editToggle").getAttribute("aria-expanded"), "false");
  assert.equal(itemIds(app).length, 13);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("editor: add an important Thursday-only item", () => {
  const app = open();
  app.click("editToggle");
  app.setValue("newText", "  보조배터리  ");
  app.setValue("newGroup", "out");
  app.click("day-4");
  assert.equal(app.$("day-4").getAttribute("aria-pressed"), "true");
  app.click("day-1");
  app.click("day-1"); // toggled back off
  assert.equal(app.$("day-1").getAttribute("aria-pressed"), "false");
  app.$("newImp").checked = true;
  submit(app, "editor");
  const s = app.storage.get(KEY);
  const added = s.items[15];
  assert.equal(s.items.length, 16);
  assert.equal(added.id, "u" + new Date(THU).getTime().toString(36));
  assert.deepEqual({ ...added, id: undefined }, { id: undefined, group: "out", text: "보조배터리", days: [4], imp: true });
  // form reset
  assert.equal(app.$("newText").value, "");
  assert.equal(app.$("newImp").checked, false);
  assert.equal(app.$("day-4").getAttribute("aria-pressed"), "false");
  app.click("editToggle");
  assert.equal(text(app, "count"), "0/14");
  assert.equal(text(app, "pill"), "중요 7개 남음");
  const li = app.$("chk-" + added.id).closest("li");
  assert.equal(li.querySelector(".tags").textContent, "중요목요일만");
  assert.equal(li.closest("section").querySelector("h2").textContent, "나가기 직전");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("editor: item for other weekdays is hidden today; days label sorted Mon-first", () => {
  const app = open();
  app.click("editToggle");
  app.setValue("newText", "분리수거");
  app.click("day-0");
  app.click("day-3");
  submit(app, "editor");
  const added = app.storage.get(KEY).items.at(-1);
  assert.deepEqual(added.days, [3, 0]);
  assert.equal(app.$("chk-" + added.id).closest("li").querySelector(".tag").textContent, "수·일요일만 · 오늘 아님");
  app.click("editToggle");
  assert.equal(app.$("chk-" + added.id), null);
  assert.equal(text(app, "count"), "0/13");
  assert.equal([...app.$("groups").querySelectorAll(".skipped")][0].textContent, "오늘은 요일이 맞지 않는 항목 2개를 숨겼습니다.");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("editor: blank text is not added", () => {
  const app = open();
  app.click("editToggle");
  app.setValue("newText", "   ");
  app.$("editor").dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(app.storage.get(KEY).items.length, 15);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("editor: delete removes the item and its check", () => {
  const app = open();
  check(app, "a1");
  app.click("editToggle");
  app.click(app.$("chk-a1").closest("li").querySelector("button.del"));
  const s = app.storage.get(KEY);
  assert.equal(s.items.length, 14);
  assert.ok(!s.items.some(i => i.id === "a1"));
  assert.deepEqual(s.done, []);
  assert.equal(app.$("chk-a1"), null);
  assert.equal(text(app, "count"), "0/12");
  assert.equal(text(app, "pill"), "중요 5개 남음");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("group with no items today shows the empty message", () => {
  const app = open({ storage: { [KEY]: { items: [{ id: "x", group: "bag", text: "열쇠", days: [], imp: true }], date: "2026-11-05", done: [], completed: [], lastDoneAt: "" } } });
  const lists = [...app.$("groups").querySelectorAll(".list")].map(l => l.textContent.trim());
  assert.equal(lists[1], "오늘 해당하는 항목이 없습니다.");
  assert.equal(lists[2], "오늘 해당하는 항목이 없습니다.");
  assert.equal(text(app, "pill"), "중요 1개 남음");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("no items at all: 0/0, never 'all done'", () => {
  const app = open({ storage: { [KEY]: { items: [], date: "2026-11-05", done: [], completed: [], lastDoneAt: "" } } });
  assert.equal(text(app, "count"), "0/0");
  assert.equal(text(app, "pill"), "점검 중");
  assert.equal(text(app, "left"), "남은 항목: ");
  assert.equal(app.$("barFill").style.width, "0%");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("restore: two clicks within 4 s resets to defaults", () => {
  const app = open();
  check(app, "a2");
  app.click("editToggle");
  app.click(app.$("chk-a1").closest("li").querySelector("button.del"));
  app.click("restore");
  assert.equal(text(app, "restore"), "한 번 더 누르면 되돌립니다");
  assert.equal(text(app, "restoreHint"), "직접 추가한 항목은 모두 지워집니다.");
  assert.equal(app.storage.get(KEY).items.length, 14, "first click does nothing yet");
  app.tick(3000);
  app.click("restore");
  const s = app.storage.get(KEY);
  assert.deepEqual(s.items.map(i => i.id), ALL_IDS);
  assert.deepEqual(s.done, []);
  assert.equal(text(app, "restore"), "기본 항목으로 되돌리기");
  assert.equal(text(app, "restoreHint"), "기본 항목으로 되돌렸습니다.");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("restore: first click expires after 4 s", () => {
  const app = open();
  app.click("editToggle");
  app.click(app.$("chk-a1").closest("li").querySelector("button.del"));
  app.click("restore");
  app.tick(4000);
  assert.equal(text(app, "restore"), "기본 항목으로 되돌리기");
  assert.equal(text(app, "restoreHint"), "");
  app.click("restore"); // arms again, does not restore
  assert.equal(app.storage.get(KEY).items.length, 14);
  assert.equal(text(app, "restore"), "한 번 더 누르면 되돌립니다");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("quirk: the stale 4 s timer wipes the '되돌렸습니다' hint after a restore", () => {
  // the first click's setTimeout is never cleared, so it later blanks the success hint
  const app = open();
  app.click("editToggle");
  app.click("restore");
  app.tick(1000);
  app.click("restore");
  assert.equal(text(app, "restoreHint"), "기본 항목으로 되돌렸습니다.");
  app.tick(3000);
  assert.equal(text(app, "restoreHint"), "");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("quirk: restore does not reset 'completed' (streak survives)", () => {
  // documented gotcha
  const app = open();
  checkAll(app);
  app.click("editToggle");
  app.click("restore");
  app.click("restore");
  assert.deepEqual(app.storage.get(KEY).completed, ["2026-11-05"]);
  assert.equal(text(app, "streak"), "1일");
  assert.equal(text(app, "count"), "0/13");
  assert.deepEqual(app.errors, []);
  app.close();
});

test("quirk: adding an item after completing does not update 'completed'", () => {
  // documented gotcha: only toggle() maintains completed, so the streak keeps today
  const app = open();
  checkAll(app);
  app.click("editToggle");
  app.setValue("newText", "우산");
  submit(app, "editor");
  app.click("editToggle");
  assert.equal(text(app, "count"), "13/14");
  assert.equal(text(app, "pill"), "점검 중");
  assert.equal(text(app, "streak"), "1일");
  assert.deepEqual(app.storage.get(KEY).completed, ["2026-11-05"]);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("quirk: deleting the last unchecked item does not mark the day completed", () => {
  // documented gotcha: removeItem() leaves completed alone even when everything left is done
  const app = open();
  for (const id of todayIds(4)) if (id !== "c2") check(app, id);
  app.click("editToggle");
  app.click(app.$("chk-c2").closest("li").querySelector("button.del"));
  app.click("editToggle");
  assert.equal(text(app, "pill"), "출발해도 됩니다");
  assert.equal(text(app, "streak"), "0일");
  assert.deepEqual(app.storage.get(KEY).completed, []);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("quirk: old saved data without 'days' arrays throws during render", () => {
  // documented gotcha: no migration; items lacking `days` crash render (uncaught error)
  const app = open({ storage: { [KEY]: { items: [{ id: "x", group: "bag", text: "열쇠", imp: false }] } } });
  assert.ok(app.errors.length > 0, "an uncaught script error is reported");
  assert.match(String(app.errors[0].detail ?? app.errors[0].message), /length|undefined/);
  app.close();
});

test("garbage in storage falls back to defaults", () => {
  const app = open({ storage: { [KEY]: "not json" } });
  assert.equal(itemIds(app).length, 13);
  assert.equal(app.storage.get(KEY).items.length, 15);
  assert.deepEqual(app.errors, []);
  app.close();
});

test("clock text updates on the 15 s tick", () => {
  const app = open({ now: new Date(2026, 10, 5, 8, 0, 50) });
  assert.equal(text(app, "clock"), "08:00");
  app.tick(15_000);
  assert.equal(text(app, "clock"), "08:01");
  assert.deepEqual(app.errors, []);
  app.close();
});
