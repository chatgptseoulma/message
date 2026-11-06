"""카카오톡 PC 내보내기(.txt) 통계 — 넣기(ingest) 전에 실행.

사용: python -I _tools/kakao_stats.py <내보낸 txt> [--chunk 2000]

출력 (마크다운)
  - 방 이름(첫 줄), 저장한 날짜
  - 날짜 구분선 줄 번호와 날짜별 메시지 수
  - 메시지 수, 사진·동영상 수, 이모티콘·파일 수, 링크가 있는 줄 수, 말한 사람 수, 많이 말한 사람 상위 15
  - 병렬로 읽기 좋게 날짜 경계에서 자른 구간 제안 (구간당 --chunk 줄 안팎)
"""
import argparse
import collections
import pathlib
import re
import sys

DATE = re.compile(r"^-{5,} (\d{4})년 (\d{1,2})월 (\d{1,2})일 .+ -{5,}$")
MSG = re.compile(r"^\[([^\]]+)\] \[(오전|오후) \d{1,2}:\d{2}\] ?(.*)$")
MEDIA = re.compile(r"^(사진|동영상|사진 \d+장)$")
OTHER = re.compile(r"^(이모티콘|파일: .+)$")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--chunk", type=int, default=2000)
    a = ap.parse_args()
    lines = pathlib.Path(a.file).read_text(encoding="utf-8-sig", errors="replace").splitlines()
    title = lines[0] if lines else ""
    saved = next((l for l in lines[:3] if l.startswith("저장한 날짜")), "")
    days, per_day, speakers = [], collections.Counter(), collections.Counter()
    media = other = links = msgs = 0
    cur = None
    for i, l in enumerate(lines, 1):
        m = DATE.match(l)
        if m:
            cur = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
            days.append((i, cur))
            continue
        m = MSG.match(l)
        if m:
            msgs += 1
            speakers[m.group(1)] += 1
            per_day[cur] += 1
            body = m.group(3).strip()
            if MEDIA.match(body):
                media += 1
            elif OTHER.match(body):
                other += 1
        if re.search(r"https?://", l):
            links += 1
    print(f"# 카카오톡 통계: {pathlib.Path(a.file).name}\n")
    print(f"- 방: {title}")
    print(f"- {saved}")
    print(f"- 줄 수: {len(lines):,}")
    print(f"- 메시지: {msgs:,} · 사진·동영상: {media:,} · 이모티콘·파일: {other:,} · 링크가 있는 줄: {links:,} · 말한 사람: {len(speakers):,}\n")
    print("## 날짜별\n\n| 날짜 | 시작 줄 | 메시지 |\n|---|---|---|")
    for ln, d in days:
        print(f"| {d} | L{ln} | {per_day[d]} |")
    print("\n## 많이 말한 사람 (상위 15)\n\n| 순위 | 닉네임 | 메시지 |\n|---|---|---|")
    for r, (n, c) in enumerate(speakers.most_common(15), 1):
        print(f"| {r} | {n} | {c} |")
    print(f"\n## 나눠 읽기 제안 (구간당 약 {a.chunk}줄, 날짜 경계 기준)\n")
    bounds = [ln for ln, _ in days] + [len(lines) + 1]
    start = 1
    for b in bounds[1:]:
        if b - start >= a.chunk:
            print(f"- L{start}-{b - 1}")
            start = b
    if start <= len(lines):
        print(f"- L{start}-{len(lines)}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
