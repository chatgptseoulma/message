// Characterization tests for 퇴근길 쉼표: C:\2026CC\퇴근길쉼표.html (fragment) and
// C:\2026CC\commute-break\index.html (same body + document wrapper).
// The SAME suite runs against both files. Black-box: tabs, clicks, fake time, stub calls.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadApp, appPath } from "./helpers/html-harness.js";

const FILES = {
  "퇴근길쉼표.html": appPath("퇴근길쉼표.html"),
  "commute-break/index.html": appPath("commute-break", "index.html"),
};

const KIND = [
  "오늘 하루 버틴 것만으로 충분해요.",
  "그 사람의 기분까지 당신이 책임질 필요는 없어요.",
  "실수 하나가 당신 전부를 말해 주지 않아요.",
  "퇴근하면 회사 일은 회사에 두고 와도 돼요.",
  "화가 나는 건 당신이 그만큼 진심이었다는 뜻이에요.",
  "지금 쉬는 것도 일의 일부예요.",
  "잘 안 풀린 날도 지나가요. 내일은 내일의 내가 해요.",
  "당신은 생각보다 훨씬 잘하고 있어요.",
  "따뜻한 물 한 잔 마시고 어깨 한 번 내려 봐요.",
  "오늘 저녁엔 좋아하는 거 하나만 하세요.",
];
const REPLY = [
  "버렸어요. 그 일은 이제 여기 두고 가요.",
  "그런 일이 있었으면 속상한 게 당연해요.",
  "말로 꺼낸 것만으로도 조금 가벼워졌을 거예요.",
  "당신 잘못이 아니에요. 오늘은 여기까지만 생각해요.",
];
const BURN_REPLY = [
  "다 타 버렸어요. 재는 바람에 날아갔어요.",
  "그 일은 연기처럼 흩어졌어요. 이제 숨 한 번 크게 쉬어요.",
  "활활 타는 거 보니까 좀 시원하죠? 그래도 돼요.",
  "남은 건 재뿐이에요. 당신 마음까지 태울 필요는 없어요.",
];
const BREATH_DONE = "1분 동안 나를 돌봤어요. 아까보다 어깨가 조금 내려갔길 바라요.";
const NUDGE = "한 줄이라도 좋아요. 떠오르는 말을 적거나 말해 보세요.";
const NO_SR = "이 브라우저는 음성 입력을 지원하지 않아요. 크롬이나 엣지에서 열어 주세요.";

test("the two files share identical body markup and script", () => {
  const a = readFileSync(FILES["퇴근길쉼표.html"], "utf8").replace(/\r\n/g, "\n");
  const b = readFileSync(FILES["commute-break/index.html"], "utf8").replace(/\r\n/g, "\n");
  // head part: <title> .. </style> is identical
  const head = s => s.slice(s.indexOf("<title>"), s.indexOf("</style>") + 8);
  assert.ok(head(a).length > 1000);
  assert.equal(head(a), head(b));
  // body + script part (from <div class="wrap"> to </script>) is identical
  const body = s => s.slice(s.indexOf('<div class="wrap">'), s.lastIndexOf("</script>") + 9);
  assert.ok(body(a).length > 1000);
  assert.equal(body(a), body(b));
  // jsdom view: same body text and element ids
  const ids = file => { const app = loadApp(file); const r = [...app.document.body.querySelectorAll("[id]")].map(e => e.id); app.close(); return r; };
  assert.deepEqual(ids(FILES["퇴근길쉼표.html"]), ids(FILES["commute-break/index.html"]));
});

for (const [label, FILE] of Object.entries(FILES)) {
  describe(label, () => {
    const open = (opts = {}) => {
      const rng = { fn: null };
      const app = loadApp(FILE, {
        ...opts,
        beforeParse(w) {
          const real = w.Math.random.bind(w.Math);
          w.Math.random = () => (rng.fn ? rng.fn() : real());
          opts.beforeParse?.(w);
        },
      });
      app.rng = rng;
      return app;
    };
    const text = (app, id) => app.$(id).textContent;
    const bubbles = app => [...app.$("sheet").querySelectorAll(".bub")];
    const pop = (app, b) => app.click(b);
    const audioCalls = app => app.calls.filter(c => c === "AudioContext" || c.startsWith("audio")).length;
    const speaks = app => app.calls.filter(c => c.startsWith("speak:")).map(c => c.slice(6));
    const tab = (app, name) => app.click("tab-" + name);

    test("initial screen: pop tab, note, counters, buttons", () => {
      const app = open();
      assert.equal(app.document.title, "퇴근길 쉼표");
      assert.equal(app.document.querySelector("h1").textContent, "오늘도 버티느라 고생했어요");
      assert.equal(text(app, "note"), "여기서는 아무도 평가하지 않아요. 천천히 쉬다 가요.");
      assert.equal(app.$("p-pop").hidden, false);
      assert.equal(app.$("p-worry").hidden, true);
      assert.equal(app.$("p-breath").hidden, true);
      assert.equal(app.$("tab-pop").getAttribute("aria-selected"), "true");
      assert.equal(text(app, "popCount"), "0 / 48");
      assert.equal(bubbles(app).length, 48);
      assert.equal(bubbles(app)[0].id, "bub-0");
      assert.equal(bubbles(app)[47].getAttribute("aria-label"), "뽁뽁이 48");
      assert.equal(text(app, "soundBtn"), "소리 끄기");
      assert.equal(text(app, "ttsBtn"), "위로 읽어주기: 켜짐");
      assert.equal(app.$("ttsBtn").getAttribute("aria-pressed"), "true");
      assert.equal(text(app, "thrownCount"), "버린 종이 0장");
      assert.equal(text(app, "cycles"), "0 / 5번");
      assert.equal(text(app, "cue"), "준비되면 시작을 눌러요");
      assert.equal(text(app, "breathBtn"), "시작");
      assert.equal(text(app, "micLabel"), "말로 털어놓기");
      assert.equal(app.calls.includes("AudioContext"), false, "audio is created lazily");
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("tabs switch panels and aria-selected", () => {
      const app = open();
      for (const name of ["worry", "breath", "pop"]) {
        tab(app, name);
        for (const n of ["pop", "worry", "breath"]) {
          assert.equal(app.$("p-" + n).hidden, n !== name, `${name}: panel ${n}`);
          assert.equal(app.$("tab-" + n).getAttribute("aria-selected"), String(n === name));
        }
      }
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("popping a bubble: class, label, count, sound; re-pop ignored", () => {
      const app = open();
      const b = bubbles(app)[3];
      pop(app, b);
      assert.ok(b.classList.contains("pop"));
      assert.equal(b.getAttribute("aria-label"), "터진 뽁뽁이");
      assert.equal(text(app, "popCount"), "1 / 48");
      assert.ok(app.calls.includes("AudioContext"));
      const n = audioCalls(app);
      pop(app, b);
      assert.equal(text(app, "popCount"), "1 / 48");
      assert.equal(audioCalls(app), n, "no sound on an already popped bubble");
      // keyboard: Enter and Space pop too
      app.fire(bubbles(app)[4], "keydown", { key: "Enter" });
      app.fire(bubbles(app)[5], "keydown", { key: " " });
      app.fire(bubbles(app)[6], "keydown", { key: "a" });
      assert.equal(text(app, "popCount"), "3 / 48");
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("every 12 pops shows a kind note; 48 pops -> sheet message and new sheet", () => {
      const app = open();
      const bs = bubbles(app);
      for (let i = 0; i < 12; i++) pop(app, bs[i]);
      assert.ok(app.$("note").classList.contains("fade"));
      app.tick(250);
      assert.ok(KIND.includes(text(app, "note")), text(app, "note"));
      assert.equal(app.$("note").classList.contains("fade"), false);
      for (let i = 12; i < 48; i++) pop(app, bs[i]);
      assert.equal(text(app, "popCount"), "48 / 48");
      app.tick(250);
      assert.equal(text(app, "note"), "한 장 다 터뜨렸어요. 벌써 1장째. 속이 조금 시원해졌나요?");
      app.tick(649);
      assert.equal(bubbles(app)[0], bs[0], "old sheet still shown before 900 ms");
      app.tick(1);
      const fresh = bubbles(app);
      assert.equal(fresh.length, 48);
      assert.notEqual(fresh[0], bs[0]);
      assert.equal(fresh.filter(b => b.classList.contains("pop")).length, 0);
      assert.equal(text(app, "popCount"), "0 / 48");
      for (const b of fresh) pop(app, b);
      app.tick(250);
      assert.equal(text(app, "note"), "한 장 다 터뜨렸어요. 벌써 2장째. 속이 조금 시원해졌나요?");
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("kind note rotates every 25 s and never repeats the previous one", () => {
      const app = open();
      const seen = [];
      for (let i = 0; i < 12; i++) {
        app.tick(25_000);
        app.tick(250);
        seen.push(text(app, "note"));
      }
      app.tick(0);
      for (const t of seen) assert.ok(KIND.includes(t), t);
      for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1]);
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("kind note pick is driven by Math.random and skips the last index", () => {
      const app = open();
      app.rng.fn = () => 0.35; // index 3
      app.tick(25_250);
      assert.equal(text(app, "note"), KIND[3]);
      const seq = [0.35, 0.35, 0.95]; // 3 (repeat -> retry), 3, 9
      app.rng.fn = () => seq.shift() ?? 0;
      app.tick(25_000);
      app.tick(250);
      assert.equal(text(app, "note"), KIND[9]);
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("no kind note rotation while the document is hidden", () => {
      const app = open({
        visible: false,
        beforeParse(w) { Object.defineProperty(w.document, "hidden", { get: () => true, configurable: true }); },
      });
      app.tick(60_000);
      assert.equal(text(app, "note"), "여기서는 아무도 평가하지 않아요. 천천히 쉬다 가요.");
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("worry: empty text nudges instead of throwing", () => {
      const app = open();
      tab(app, "worry");
      app.setValue("worry", "   ");
      app.click("crumpleBtn");
      app.tick(250);
      assert.equal(text(app, "note"), NUDGE);
      assert.equal(text(app, "thrownCount"), "버린 종이 0장");
      assert.equal(app.$("crumpleBtn").disabled, false);
      app.click("burnBtn");
      assert.equal(app.$("paper").querySelector("canvas.fire"), null);
      assert.equal(app.$("burnBtn").disabled, false);
      assert.deepEqual(speaks(app), []);
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("worry: crumple animation, reply rotation, counter and speech", () => {
      const app = open();
      tab(app, "worry");
      for (let k = 0; k < 5; k++) {
        app.setValue("worry", `회의에서 말이 끊겼다 ${k}`);
        app.click("crumpleBtn");
        assert.ok(app.$("paper").classList.contains("crumple"));
        assert.equal(app.$("crumpleBtn").disabled, true);
        assert.equal(app.$("burnBtn").disabled, true);
        app.tick(1149);
        assert.equal(app.$("worry").value, `회의에서 말이 끊겼다 ${k}`);
        app.tick(1);
        assert.equal(app.$("paper").classList.contains("crumple"), false);
        assert.equal(app.$("worry").value, "");
        assert.equal(text(app, "thrownCount"), `버린 종이 ${k + 1}장`);
        assert.equal(app.$("crumpleBtn").disabled, false);
        assert.equal(speaks(app).length, k, "speech is delayed 150 ms after cancel");
        app.tick(150);
        assert.equal(speaks(app).length, k + 1);
        assert.equal(speaks(app).at(-1), REPLY[k % 4]);
        app.tick(100);
        assert.equal(text(app, "note"), REPLY[k % 4]);
      }
      assert.ok(app.calls.includes("speech.cancel"));
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("worry: burn adds a fire canvas, then clears and replies", () => {
      const app = open();
      tab(app, "worry");
      app.setValue("worry", "서운했다");
      app.click("burnBtn");
      assert.ok(app.$("paper").querySelector("canvas.fire"), "fire overlay added");
      assert.equal(app.$("crumpleBtn").disabled, true);
      assert.equal(app.$("burnBtn").disabled, true);
      // throw lock: crumpling while burning does nothing
      app.click("crumpleBtn");
      assert.equal(app.$("paper").classList.contains("crumple"), false);
      app.tick(3000);
      assert.equal(text(app, "thrownCount"), "버린 종이 0장");
      app.tick(1500);
      assert.equal(app.$("paper").querySelector("canvas.fire"), null, "overlay removed");
      assert.equal(app.$("worry").value, "");
      assert.equal(app.$("worry").style.visibility, "");
      assert.equal(text(app, "thrownCount"), "버린 종이 1장");
      assert.equal(app.$("burnBtn").disabled, false);
      app.tick(400);
      assert.equal(text(app, "note"), BURN_REPLY[0]);
      assert.deepEqual(speaks(app), [BURN_REPLY[0]]);
      assert.ok(app.calls.some(c => c.startsWith("canvas")), "drawn on canvas");
      // reply index follows the shared thrown counter
      app.setValue("worry", "하나 더");
      app.click("crumpleBtn");
      app.tick(1600);
      assert.equal(text(app, "note"), REPLY[1]);
      app.setValue("worry", "또");
      app.click("burnBtn");
      app.tick(6000);
      assert.equal(text(app, "note"), BURN_REPLY[2]);
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("quirk: switching tabs does not cancel a burn in progress", () => {
      // documented gotcha
      const app = open();
      tab(app, "worry");
      app.setValue("worry", "서운했다");
      app.click("burnBtn");
      tab(app, "pop");
      app.tick(6000);
      assert.equal(text(app, "thrownCount"), "버린 종이 1장");
      assert.equal(text(app, "note"), BURN_REPLY[0]);
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("quirk: the 25 s kind timer overwrites a throw reply", () => {
      // documented gotcha
      const app = open();
      tab(app, "worry");
      app.setValue("worry", "피곤했다");
      app.click("crumpleBtn");
      app.tick(1600);
      assert.equal(text(app, "note"), REPLY[0]);
      app.tick(25_000 - 1600 + 250);
      assert.ok(KIND.includes(text(app, "note")));
      assert.notEqual(text(app, "note"), REPLY[0]);
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("TTS toggle: off silences replies, on speaks a confirmation", () => {
      const app = open();
      tab(app, "worry");
      app.click("ttsBtn");
      assert.equal(app.$("ttsBtn").getAttribute("aria-pressed"), "false");
      assert.equal(text(app, "ttsBtn"), "위로 읽어주기: 꺼짐");
      assert.ok(app.calls.includes("speech.cancel"));
      app.setValue("worry", "짜증났다");
      app.click("crumpleBtn");
      app.tick(2000);
      assert.equal(text(app, "note"), REPLY[0]);
      assert.deepEqual(speaks(app), []);
      app.click("ttsBtn");
      assert.equal(app.$("ttsBtn").getAttribute("aria-pressed"), "true");
      assert.equal(text(app, "ttsBtn"), "위로 읽어주기: 켜짐");
      app.tick(149);
      assert.deepEqual(speaks(app), []);
      app.tick(1);
      assert.deepEqual(speaks(app), ["네, 제가 읽어 드릴게요."]);
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("TTS button is disabled when speechSynthesis is missing", () => {
      const app = open({ beforeParse(w) { delete w.speechSynthesis; w.speechSynthesis = undefined; } });
      assert.equal(app.$("ttsBtn").disabled, true);
      assert.equal(text(app, "ttsBtn"), "읽어주기 지원 안 됨");
      tab(app, "worry");
      app.setValue("worry", "x");
      app.click("crumpleBtn");
      app.tick(2000);
      assert.equal(text(app, "note"), REPLY[0]);
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("breathing: phases, 5 cycles x 12 s, finishing message and speech", () => {
      const app = open();
      tab(app, "breath");
      app.click("breathBtn");
      assert.equal(text(app, "breathBtn"), "멈추기");
      assert.equal(text(app, "cue"), "들이쉬고");
      assert.equal(app.$("orb").style.width, "88%");
      assert.equal(app.$("orb").style.transitionDuration, "4000ms");
      assert.ok(app.calls.includes("AudioContext"), "tone played");
      app.tick(4000);
      assert.equal(text(app, "cue"), "잠깐 멈추고");
      assert.equal(app.$("orb").style.transitionDuration, "2000ms");
      app.tick(2000);
      assert.equal(text(app, "cue"), "천천히 내쉬어요");
      assert.equal(app.$("orb").style.width, "40%");
      assert.equal(app.$("orb").style.transitionDuration, "6000ms");
      app.tick(5999);
      assert.equal(text(app, "cycles"), "0 / 5번");
      app.tick(1);
      assert.equal(text(app, "cycles"), "1 / 5번");
      assert.equal(text(app, "cue"), "들이쉬고");
      app.tick(12_000 * 3);
      assert.equal(text(app, "cycles"), "4 / 5번");
      assert.equal(text(app, "breathBtn"), "멈추기");
      app.tick(12_000);
      assert.equal(text(app, "cycles"), "5 / 5번");
      assert.equal(text(app, "cue"), "잘했어요");
      assert.equal(text(app, "breathBtn"), "시작");
      assert.equal(app.$("orb").style.width, "40%");
      app.tick(250);
      assert.equal(text(app, "note"), BREATH_DONE);
      assert.ok(speaks(app).includes(BREATH_DONE));
      app.tick(20_000);
      assert.equal(text(app, "cycles"), "5 / 5번", "stays finished");
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("breathing: stop button and leaving the tab both reset", () => {
      const app = open();
      tab(app, "breath");
      app.click("breathBtn");
      app.tick(13_000);
      assert.equal(text(app, "cycles"), "1 / 5번");
      app.click("breathBtn");
      assert.equal(text(app, "breathBtn"), "시작");
      assert.equal(text(app, "cue"), "준비되면 시작을 눌러요");
      assert.equal(app.$("orb").style.transitionDuration, "800ms");
      app.tick(30_000);
      assert.equal(text(app, "cycles"), "1 / 5번", "no more progress");
      // restart resets the counter
      app.click("breathBtn");
      assert.equal(text(app, "cycles"), "0 / 5번");
      app.tick(4000);
      tab(app, "pop");
      assert.equal(text(app, "breathBtn"), "시작");
      assert.equal(text(app, "cue"), "준비되면 시작을 눌러요");
      app.tick(20_000);
      assert.equal(text(app, "cycles"), "0 / 5번");
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("sound toggle: off stops pop sounds", () => {
      const app = open();
      app.click("soundBtn");
      assert.equal(text(app, "soundBtn"), "소리 켜기");
      pop(app, bubbles(app)[0]);
      assert.equal(audioCalls(app), 0);
      app.click("soundBtn");
      assert.equal(text(app, "soundBtn"), "소리 끄기");
      pop(app, bubbles(app)[1]);
      assert.ok(audioCalls(app) > 0);
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("quirk: turning sound off also mutes the breathing tones", () => {
      // documented gotcha: the pop-tab sound toggle is global
      const app = open();
      app.click("soundBtn");
      tab(app, "breath");
      app.click("breathBtn");
      app.tick(12_000);
      assert.equal(audioCalls(app), 0);
      assert.equal(text(app, "cycles"), "1 / 5번");
      assert.deepEqual(app.errors, []);
      app.close();
    });

    test("mic button without SpeechRecognition shows an unsupported message", () => {
      const app = open();
      tab(app, "worry");
      app.click("micBtn");
      assert.equal(text(app, "micStatus"), NO_SR);
      assert.equal(app.$("micBtn").getAttribute("aria-pressed"), "false");
      assert.equal(text(app, "micLabel"), "말로 털어놓기");
      assert.deepEqual(app.errors, []);
      app.close();
    });

    describe("dictation with a fake SpeechRecognition", () => {
      const openSR = () => open({ speechRecognition: true });
      const startMic = app => { tab(app, "worry"); app.click("micBtn"); return app.recognizers.at(-1); };

      test("start: listening UI, settings, cancels speech", () => {
        const app = openSR();
        const rec = startMic(app);
        assert.ok(rec, "a recognizer was created");
        assert.equal(rec.lang, "ko-KR");
        assert.equal(rec.continuous, true);
        assert.equal(rec.interimResults, true);
        assert.equal(rec.started, 1);
        assert.equal(app.$("micBtn").getAttribute("aria-pressed"), "true");
        assert.equal(text(app, "micLabel"), "듣고 있어요. 다 말했으면 누르세요");
        assert.equal(text(app, "micStatus"), "듣고 있어요. 속상했던 일을 그냥 말해 보세요.");
        assert.ok(app.calls.includes("speech.cancel"));
        assert.deepEqual(app.errors, []);
        app.close();
      });

      test("interim and final results write into the paper", () => {
        const app = openSR();
        tab(app, "worry");
        app.setValue("worry", "오늘");
        app.click("micBtn");
        const rec = app.recognizers[0];
        rec.emitResult([{ text: "회의가", final: false }]);
        assert.equal(text(app, "micStatus"), "들리는 말: 회의가");
        assert.equal(app.$("micStatus").querySelector("i").textContent, "회의가");
        assert.equal(app.$("worry").value, "오늘");
        rec.emitResult([{ text: " 회의가 길었다 ", final: true }]);
        assert.equal(app.$("worry").value, "오늘 회의가 길었다");
        assert.equal(text(app, "micStatus"), "계속 말해도 돼요. 들은 말은 종이에 적고 있어요.");
        rec.emitResult([{ text: "회의가 길었다", final: true }, { text: "진짜", final: true }, { text: "서운", final: false }], 1);
        assert.equal(app.$("worry").value, "오늘 회의가 길었다 진짜");
        assert.equal(text(app, "micStatus"), "들리는 말: 서운");
        assert.deepEqual(app.errors, []);
        app.close();
      });

      test("onend restarts while listening; pressing again stops", () => {
        const app = openSR();
        const rec = startMic(app);
        rec.end();
        assert.equal(rec.started, 2, "auto-restarted");
        assert.equal(app.$("micBtn").getAttribute("aria-pressed"), "true");
        app.click("micBtn");
        assert.equal(rec.stopped, 1);
        app.tick(0);
        assert.equal(rec.started, 2, "no restart after the user stopped");
        assert.equal(app.$("micBtn").getAttribute("aria-pressed"), "false");
        assert.equal(text(app, "micLabel"), "말로 털어놓기");
        assert.deepEqual(app.errors, []);
        app.close();
      });

      test("permission / network errors stop listening with a message", () => {
        for (const [code, msg] of [
          ["not-allowed", "여기서는 마이크를 쓸 수 없어요. 파일을 크롬이나 엣지로 직접 열고 마이크를 허용하면 말로 할 수 있어요. 지금은 글로 적어 주세요."],
          ["service-not-allowed", "여기서는 마이크를 쓸 수 없어요. 파일을 크롬이나 엣지로 직접 열고 마이크를 허용하면 말로 할 수 있어요. 지금은 글로 적어 주세요."],
          ["audio-capture", "여기서는 마이크를 쓸 수 없어요. 파일을 크롬이나 엣지로 직접 열고 마이크를 허용하면 말로 할 수 있어요. 지금은 글로 적어 주세요."],
          ["network", "음성 인식은 인터넷 연결이 필요해요."],
        ]) {
          const app = openSR();
          const rec = startMic(app);
          rec.emitError(code);
          assert.equal(text(app, "micStatus"), msg, code);
          rec.end();
          assert.equal(rec.started, 1, `${code}: no restart`);
          assert.equal(app.$("micBtn").getAttribute("aria-pressed"), "false");
          assert.deepEqual(app.errors, []);
          app.close();
        }
      });

      test("quirk: no-speech / aborted errors keep restarting recognition", () => {
        // documented gotcha: only some error codes clear wantListen, so onend restarts in a loop
        const app = openSR();
        const rec = startMic(app);
        rec.emitError("no-speech");
        assert.equal(text(app, "micStatus"), "아직 아무 말도 안 들렸어요. 편하게 말해 보세요.");
        rec.end();
        rec.emitError("no-speech");
        rec.end();
        rec.emitError("aborted");
        rec.end();
        assert.equal(rec.started, 4);
        assert.equal(app.$("micBtn").getAttribute("aria-pressed"), "true");
        assert.equal(text(app, "micStatus"), "아직 아무 말도 안 들렸어요. 편하게 말해 보세요.", "aborted shows no message");
        assert.deepEqual(app.errors, []);
        app.close();
      });

      test("start() throwing shows the retry message", () => {
        const app = open({
          speechRecognition: true,
          beforeParse(w) { const C = w.SpeechRecognition; C.prototype.start = function () { throw new Error("busy"); }; },
        });
        tab(app, "worry");
        app.click("micBtn");
        assert.equal(text(app, "micStatus"), "마이크를 켜지 못했어요. 잠시 뒤 다시 눌러 주세요.");
        assert.equal(app.$("micBtn").getAttribute("aria-pressed"), "false");
        assert.deepEqual(app.errors, []);
        app.close();
      });

      test("leaving the worry tab and throwing both stop listening", () => {
        const app = openSR();
        const rec = startMic(app);
        tab(app, "pop");
        assert.equal(rec.stopped, 1);
        app.tick(0);
        assert.equal(app.$("micBtn").getAttribute("aria-pressed"), "false");
        const rec2 = startMic(app);
        app.setValue("worry", "말한 내용");
        app.click("crumpleBtn");
        assert.equal(rec2.stopped, 1);
        app.tick(0);
        assert.equal(rec2.started, 1);
        assert.equal(app.$("micBtn").getAttribute("aria-pressed"), "false");
        assert.deepEqual(app.errors, []);
        app.close();
      });

      test("quirk: typed text is overwritten by the next final speech result", () => {
        // documented gotcha: dictation keeps its own `base` and ignores manual edits
        const app = openSR();
        const rec = startMic(app);
        rec.emitResult([{ text: "첫 문장", final: true }]);
        app.setValue("worry", "첫 문장 그리고 손으로 쓴 말");
        rec.emitResult([{ text: "두 번째", final: true }]);
        assert.equal(app.$("worry").value, "첫 문장 두 번째");
        assert.deepEqual(app.errors, []);
        app.close();
      });

      test("quirk: a late onresult after a throw writes the thrown text back", () => {
        // documented gotcha: the old recognizer's onresult still holds the pre-throw base
        const app = openSR();
        const rec = startMic(app);
        rec.emitResult([{ text: "버릴 말", final: true }]);
        app.click("crumpleBtn");
        app.tick(1600);
        assert.equal(app.$("worry").value, "");
        rec.emitResult([{ text: "늦은 말", final: true }]);
        assert.equal(app.$("worry").value, "버릴 말 늦은 말");
        assert.deepEqual(app.errors, []);
        app.close();
      });
    });
  });
}
