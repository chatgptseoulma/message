"""LLM Wiki 점검 (lint) — 표준 라이브러리만 사용.

사용: python -I _tools/kb_lint.py <볼트 경로>   (보통 docs/kb 에서 `python -I _tools/kb_lint.py .`)

검사 항목
  오류 (종료 코드 1): 깨진 위키 링크, 볼트 안 이름 겹침, wiki 페이지 frontmatter 누락·필수 키 누락,
                     표 안에서 escape 안 된 별칭 링크 [[a|b]]
  경고: 들어오는 링크가 전혀 없는 페이지(고아), 목차·기록에서만 연결된 페이지,
        sources 에 줄 번호(L123)가 없는 entity·concept·analysis 페이지
"""
import pathlib
import re
import sys

SKIP_DIRS = {".obsidian", ".claude", "_templates", "_tools", "raw", ".trash"}
HUB = re.compile(r"^(index|log|README|CLAUDE|.+-목차|.+-기록|.+-개요)$")
LINK = re.compile(r"\[\[([^\]]+?)\]\]")
REQUIRED = ("type", "updated")


def pages(vault):
    out = {}
    for p in vault.rglob("*.md"):
        if any(part in SKIP_DIRS for part in p.relative_to(vault).parts[:-1]):
            continue
        out.setdefault(p.stem, []).append(p)
    return out


def frontmatter(text):
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 4)
    if end < 0:
        return None
    fm = {}
    for line in text[4:end].splitlines():
        if ":" in line and not line.startswith(" "):
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip()
    return fm


def target(raw):
    name = raw.split("|", 1)[0].rstrip("\\")
    name = name.split("#", 1)[0].strip()
    return pathlib.PurePath(name).name.removesuffix(".md") if name else None


def main():
    vault = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    allp = pages(vault)
    errors, warns = [], []
    for name, ps in allp.items():
        if len(ps) > 1:
            errors.append(f"이름 겹침: {name} -> " + ", ".join(str(p.relative_to(vault)) for p in ps))
    inbound = {n: set() for n in allp}
    inbound_content = {n: set() for n in allp}
    for name, ps in allp.items():
        p = ps[0]
        rel = p.relative_to(vault)
        text = p.read_text(encoding="utf-8")
        in_wiki = "wiki" in rel.parts
        fm = frontmatter(text)
        if in_wiki or name in ("index", "log"):
            if fm is None:
                errors.append(f"frontmatter 없음: {rel}")
            else:
                for k in REQUIRED:
                    if k not in fm:
                        errors.append(f"frontmatter '{k}' 없음: {rel}")
                if fm.get("type") in ("entity", "concept", "analysis") and "src-" in fm.get("sources", "") \
                        and not re.search(r"\bL\d+", fm.get("sources", "")):
                    warns.append(f"sources 에 줄 번호 없음: {rel}")
        in_code = False
        for i, line in enumerate(text.splitlines(), 1):
            if line.lstrip().startswith("```"):
                in_code = not in_code
            if in_code:
                continue
            line_nocode = re.sub(r"`[^`]*`", "", line)
            for m in LINK.finditer(line_nocode):
                t = target(m.group(1))
                if not t:
                    continue
                if t not in allp:
                    errors.append(f"깨진 링크: {rel}:{i} -> [[{m.group(1)}]]")
                elif t != name:
                    inbound[t].add(name)
                    if not HUB.match(name):
                        inbound_content[t].add(name)
            if line.lstrip().startswith("|") and re.search(r"\[\[[^\]]*[^\\\]]\|[^\]]*\]\]", line_nocode):
                errors.append(f"표 안 별칭 escape 필요 ([[a\\|b]]): {rel}:{i}")
    for name in allp:
        if HUB.match(name):
            continue
        rel = allp[name][0].relative_to(vault)
        if not inbound[name]:
            warns.append(f"고아 페이지 (들어오는 링크 없음): {rel}")
        elif not inbound_content[name]:
            warns.append(f"목차·기록에서만 연결됨: {rel}")
    total = sum(1 for n in allp if not HUB.match(n))
    print(f"볼트: {vault}")
    print(f"페이지: {total} (허브 제외) / 전체 {len(allp)}")
    print(f"오류 {len(errors)}건, 경고 {len(warns)}건")
    for e in errors:
        print("  [오류]", e)
    for w in warns:
        print("  [경고]", w)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
