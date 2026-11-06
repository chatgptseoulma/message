"""PreToolUse 훅: .env 파일(.env, .env.local, .env.production 등)을 고치지 못하게 막는다.

- 파일 도구(Write, Edit, MultiEdit, NotebookEdit): 대상 파일 이름이 .env 또는 .env.* 이면 거부
- 셸(Bash, PowerShell): 명령에 .env 파일이 나오고, 쓰기·지우기·옮기기 같은 동작이 함께 있으면 거부
  (읽기만 하는 명령은 막지 않음)
- 입력을 읽지 못하면 아무것도 막지 않는다 (훅 오류로 모든 작업이 멈추지 않게)

결과는 Claude Code 형식의 JSON 으로 표준 출력에 낸다:
  {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", ...}}
"""
import json
import os
import re
import sys

FILE_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit"}
SHELL_TOOLS = {"Bash", "PowerShell"}

# 셸 명령 안의 .env 파일 이름 (경로 구분자, 따옴표, 공백 등으로 둘러싸인 것)
ENV_IN_COMMAND = re.compile(r"""(?:^|[\s"'`/\\=:(])\.env(?:\.[A-Za-z0-9_-]+)*(?=$|[\s"'`;|&)>,])""")
# 파일을 바꾸는 셸 동작
WRITE_IN_COMMAND = re.compile(
    r"""(>|\btee\b|\bsed\s+-i|\bperl\s+-i|\btruncate\b|\brm\b|\bdel\b|\berase\b|\bmv\b|\bcp\b|\bmove\b|\bcopy\b|\bren(?:ame)?\b|\btouch\b"""
    r"""|Set-Content|Add-Content|Out-File|Clear-Content|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item"""
    r"""|WriteAll(?:Text|Lines|Bytes)|AppendAll(?:Text|Lines))""",
    re.IGNORECASE,
)


def is_env_name(path: str) -> bool:
    name = os.path.basename(str(path).replace("\\", "/").rstrip("/")).lower()
    return name == ".env" or name.startswith(".env.")


def deny(reason: str) -> None:
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
    # ASCII 로만 출력(한글은 \uXXXX): Windows 코드 페이지(cp949)와 상관없이 깨지지 않게
    sys.stdout.write(json.dumps(out, ensure_ascii=True))
    sys.stdout.flush()
    sys.exit(0)


def main() -> None:
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
    except Exception:
        sys.exit(0)  # 입력을 못 읽으면 막지 않음
    tool = data.get("tool_name") or ""
    ti = data.get("tool_input") or {}

    if tool in FILE_TOOLS:
        path = ti.get("file_path") or ti.get("notebook_path") or ""
        if path and is_env_name(path):
            deny(f".env 파일은 고칠 수 없게 막혀 있어요 (훅: .claude/hooks/block_env_edit.py). 대상: {path}")

    elif tool in SHELL_TOOLS:
        cmd = str(ti.get("command") or "")
        if ENV_IN_COMMAND.search(cmd) and WRITE_IN_COMMAND.search(cmd):
            deny(".env 파일을 바꾸는 셸 명령은 막혀 있어요 (훅: .claude/hooks/block_env_edit.py).")

    sys.exit(0)


if __name__ == "__main__":
    main()
