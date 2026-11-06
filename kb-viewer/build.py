"""KB 뷰어 공유본 만들기 — 서버 없이 더블클릭으로 열리는 HTML 파일 하나를 만듭니다.

사용: python kb-viewer/build.py [--kb <볼트 경로>] [--out <폴더>]
결과 (기본 kb-viewer/dist/):
  KB뷰어.html           위키만 들어 있음 (카톡 원문 없음). 다른 사람에게 보낼 때 권장.
  KB뷰어_원문포함.html   카톡 원문(raw/)까지 들어 있음. 원문 줄 링크·원문 검색이 됩니다.

원문 포함본에는 대화 참여자의 닉네임·메시지가 그대로 들어갑니다. 받는 사람을 가려서 공유하세요.
"""
import argparse
import datetime
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import server  # noqa: E402  (같은 폴더의 server.py 를 그대로 재사용)

LREF_A = re.compile(r'<a class="lref" href="[^"]*" title="[^"]*">([^<]*)</a>')


def collect(include_raw):
    pages = server.scan()
    tree = server.api_tree({})
    data = {
        "built": datetime.date.today().isoformat(),
        "hasRaw": include_raw,
        "tree": tree,
        "graph": server.api_graph({}),
        "stats": server.api_stats({}),
        "labels": {f["id"]: f["label"] for f in tree["folders"]},
        "pages": {}, "search": {}, "raw": {},
    }
    for name, p in pages.items():
        page = server.api_page({"name": [name]})
        if not include_raw:  # 원문 줄 링크를 글자로 바꿈 (눌러도 갈 곳이 없으므로)
            page["html"] = LREF_A.sub(r'<span class="lref">\1</span>', page["html"])
            page["sourcesHtml"] = [LREF_A.sub(r'<span class="lref">\1</span>', s) for s in page["sourcesHtml"]]
        data["pages"][name] = page
        tags = p["fm"].get("tags", [])
        data["search"][name] = {
            "name": name, "title": p["title"], "folder": server.folder_label(p["folder"]),
            "tags": " ".join(tags) if isinstance(tags, list) else str(tags),
            "text": p["title"] + "\n" + p["body"],
            "lines": [server.plain(l) for l in p["body"].splitlines() if l.strip() and not l.startswith("#")],
        }
    if include_raw:
        for f in tree["folders"]:
            if f.get("raw"):
                data["raw"][f["id"]] = {
                    fn: (server.KB / f["id"] / "raw" / fn).read_text(encoding="utf-8-sig", errors="replace").splitlines()
                    for fn in f["raw"]
                }
    else:
        for f in data["tree"]["folders"]:
            f["raw"] = []
    return data


def build(include_raw, out):
    html = (HERE / "static" / "index.html").read_text(encoding="utf-8")
    payload = json.dumps(collect(include_raw), ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("</", "<\\/")  # </script> 로 스크립트가 끊기지 않게
    marker = "<script>\n(() => {"
    if marker not in html:
        sys.exit("index.html 구조가 바뀌어 데이터를 넣을 자리를 못 찾았어요.")
    html = html.replace(marker, f"<script>window.KB_DATA = {payload};</script>\n{marker}", 1)
    html = html.replace("<title>KB 뷰어</title>", "<title>KB 뷰어 (공유본)</title>", 1)
    name = "KB뷰어_원문포함.html" if include_raw else "KB뷰어.html"
    path = out / name
    path.write_text(html, encoding="utf-8")
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kb", default=str(HERE.parent / "docs" / "kb"))
    ap.add_argument("--out", default=str(HERE / "dist"))
    a = ap.parse_args()
    server.KB = pathlib.Path(a.kb).resolve()
    out = pathlib.Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    for include_raw in (False, True):
        p = build(include_raw, out)
        print(f"만듦: {p}  ({p.stat().st_size / 1024:,.0f} KB)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
