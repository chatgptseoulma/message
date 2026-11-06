"""Test harness for survey/server.py.

!!! THIS IS THE ONLY FILE THAT KNOWS ABOUT server.py INTERNALS !!!
Coupling points (update these if a refactor renames/moves things):
  - SERVER_SRC / STATIC_SRC     : where the app lives
  - files copied                : server.py + static/   (never survey.db / admin_password.txt)
  - module attributes used      : Handler, init_db, BASE/DB_PATH/PW_PATH/STATIC (implicitly,
                                  via __file__ of the copied module)
  - password file name          : admin_password.txt (next to server.py)
  - DB file / table             : survey.db, table `responses`  (used only by reset_db)
  - Handler.log_message         : silenced in a subclass to keep test output clean

Everything else in the test suite talks to the server over HTTP only.
"""
import importlib.util
import itertools
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

# C:\2026CC\survey by default; set SURVEY_APP_DIR to test another copy (e.g. a refactor branch)
APP_DIR = Path(os.environ.get("SURVEY_APP_DIR") or Path(__file__).resolve().parents[2] / "survey")
SERVER_SRC = APP_DIR / "server.py"
STATIC_SRC = APP_DIR / "static"

TEST_PASSWORD = "test-admin-pw-42"

_counter = itertools.count()


class RunningServer:
    """A copy of the app running on 127.0.0.1:<random port> inside a temp dir."""

    def __init__(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="survey_test_", ignore_cleanup_errors=True)
        self.root = Path(self._tmp.name)
        shutil.copy2(SERVER_SRC, self.root / "server.py")
        shutil.copytree(STATIC_SRC, self.root / "static")
        (self.root / "admin_password.txt").write_text(TEST_PASSWORD, encoding="utf-8")
        self.password = TEST_PASSWORD
        self.db_path = self.root / "survey.db"

        mod_name = f"survey_server_under_test_{next(_counter)}"
        spec = importlib.util.spec_from_file_location(mod_name, self.root / "server.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[mod_name] = module
        spec.loader.exec_module(module)
        self.module = module
        self._mod_name = mod_name

        # sanity: paths must point into the temp dir, never the real app folder
        assert Path(module.DB_PATH).resolve() == self.db_path.resolve(), module.DB_PATH
        assert Path(module.PW_PATH).resolve().parent == self.root.resolve(), module.PW_PATH

        module.init_db()

        class QuietHandler(module.Handler):
            def log_message(self, fmt, *args):  # keep unittest output readable
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        self.httpd.daemon_threads = True
        self.host, self.port = self.httpd.server_address[:2]
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self._thread.start()

    def static_bytes(self, name):
        return (self.root / "static" / name).read_bytes()

    def reset_db(self):
        """Delete all survey rows (keeps the schema)."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("DELETE FROM responses")
            conn.commit()
        finally:
            conn.close()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        sys.modules.pop(self._mod_name, None)
        self.module = None
        self._tmp.cleanup()


def start_server():
    return RunningServer()
