"""LLM Wiki 검색 — 표준 라이브러리만 사용하는 간단한 순위 검색.

Karpathy 원문: 규모가 작을 때는 단순한 검색 스크립트로 충분하다 (규모가 커지면 qmd 같은 도구).

사용: python -I _tools/kb_search.py <볼트 경로> "<낱말들>" [--raw] [-n 10]
  - 낱말은 공백으로 나눕니다. 모든 낱말을 포함한 페이지가 위로 옵니다.
  - 점수: 제목 ×5, tags ×3, 본문 등장 횟수 ×1
  - --raw 를 붙이면 raw/ 원문(txt·md)도 찾고, 맞는 줄 번호를 보여 줍니다.
"""
import argparse
import pathlib
import re
import sys

SKIP = {".obsidian", ".claude", "_templates", "_tools", ".trash"}


def files(vault, include_raw):
    for p in vault.rglob("*"):
        if not p.is_file() or p.suffix not in (".md", ".txt"):
            continue
        parts = p.relative_to(vault).parts
        if any(x in SKIP for x in parts):
            continue
        is_raw = "raw" in parts
        if is_raw and not include_raw:
            continue
        if not is_raw and p.suffix != ".md":
            continue
        yield p, is_raw


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("vault")
    ap.add_argument("query")
    ap.add_argument("--raw", action="store_true")
    ap.add_argument("-n", type=int, default=10)
    a = ap.parse_args()
    vault = pathlib.Path(a.vault).resolve()
    terms = [t.lower() for t in a.query.split() if t]
    results = []
    for p, is_raw in files(vault, a.raw):
        text = p.read_text(encoding="utf-8", errors="replace")
        low = text.lower()
        title = p.stem.lower()
        tags = " ".join(re.findall(r"^tags:\s*(.*)$", low, re.M))
        hits = [low.count(t) for t in terms]
        matched = sum(1 for h in hits if h)
        if not matched:
            continue
        score = matched * 100 + sum(hits) + sum(5 for t in terms if t in title) + sum(3 for t in terms if t in tags)
        lines = [(i, l.strip()) for i, l in enumerate(text.splitlines(), 1) if any(t in l.lower() for t in terms)]
        results.append((score, p, is_raw, lines))
    results.sort(key=lambda r: -r[0])
    for want_raw, label in ((False, "위키"), (True, "원문")):
        group = [r for r in results if r[2] == want_raw][: a.n]
        if want_raw and not a.raw:
            continue
        print(f"== {label} ({len(group)})")
        for score, p, is_raw, lines in group:
            print(f"[{label}] {p.relative_to(vault)}  (점수 {score})")
            for i, l in lines[: (8 if is_raw else 3)]:
                print(f"    L{i}: {l[:120]}")
    if not results:
        print("결과 없음")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
