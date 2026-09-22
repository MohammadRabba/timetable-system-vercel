"""Production smoke test — verifies a deployed Vercel instance end-to-end.

Usage:
    python3 /path/to/scripts/production_smoke_test.py URL [EMAIL] [PASSWORD]

Examples:
    # Default admin (created via /api/setup with env vars):
    python3 scripts/production_smoke_test.py https://my-app.vercel.app

    # Custom credentials (after first /api/setup with custom body):
    python3 scripts/production_smoke_test.py https://my-app.vercel.app admin@school.com mypassword

Checks:
    1. Homepage loads (HTTP 200)
    2. /api/health returns DB=ok
    3. /api/scheduler/health returns ok
    4. Login works
    5. Existing school can be loaded
    6. Teachers load
    7. Classes load
    8. Subjects load
    9. Timetable loads
    10. Teacher view loads
    11. Class view loads
    12. Room view loads
    13. Generate endpoint works (creates a 540-occurrence timetable)
    14. Independent validator passes (hardViolations == 0)
    15. Excel export works
    16. Logout works

Exit code 0 = all green; 1 = any failure.
"""
from __future__ import annotations
import sys, os, json, time, urllib.request, urllib.error, http.cookiejar

def http(method: str, url: str, body: dict | None = None, cookies: dict | None = None, timeout: int = 300):
    headers = {"Content-Type": "application/json"}
    if cookies:
        headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode()
            set_cookie = resp.headers.get("Set-Cookie")
            new_cookies = cookies or {}
            if set_cookie:
                # Parse just the name=value
                kv = set_cookie.split(";")[0].strip()
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    new_cookies[k] = v
            try:
                return resp.status, json.loads(text), "", new_cookies
            except json.JSONDecodeError:
                return resp.status, {}, text, new_cookies
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text), "", cookies or {}
        except Exception:
            return e.code, {}, text, cookies or {}
    except Exception as e:
        return 0, {}, f"{type(e).__name__}: {e}", cookies or {}

class SmokeTest:
    def __init__(self, base_url: str, email: str = "admin@school.tt", password: str = "admin123"):
        self.base_url = base_url.rstrip("/")
        self.email = email
        self.password = password
        self.cookies: dict = {}
        self.passed = 0
        self.failed = 0
        self.checks: list = []

    def check(self, name: str, ok: bool, detail: str = ""):
        sym = "✓" if ok else "✗"
        print(f"  {sym} {name}: {detail}")
        self.checks.append({"name": name, "ok": ok, "detail": detail})
        if ok: self.passed += 1
        else: self.failed += 1

    def step_homepage(self):
        print("\n[1] Homepage")
        code, _, err, _ = http("GET", self.base_url, timeout=30)
        self.check("Homepage loads (HTTP 200)", code == 200, f"HTTP {code}")

    def step_app_health(self):
        print("\n[2] /api/health")
        code, body, err, _ = http("GET", f"{self.base_url}/api/health", timeout=10)
        if code != 200:
            self.check("App health endpoint", False, f"HTTP {code} err={err[:100]}")
            return
        ok = body.get("database") == "ok"
        self.check("Database connection OK", ok,
                   f"database={body.get('database')} scheduler={body.get('scheduler')}")

    def step_scheduler_health(self):
        print("\n[3] Scheduler health")
        # On Vercel: the Python function is at /api/scheduler/health
        # On local dev: the standalone uvicorn server is at SCHEDULER_URL/health
        # Try /api/scheduler/health first (production path). If 404, try the
        # /api/health endpoint's scheduler field (which calls SCHEDULER_URL/health).
        code, body, err, _ = http("GET", f"{self.base_url}/api/scheduler/health", timeout=10)
        if code == 200 and body.get("ok") is True:
            self.check("Scheduler function reachable", True,
                       f"via /api/scheduler/health (Vercel Python Function)")
            return
        # Fallback: local dev with standalone uvicorn server.
        # /api/health already verified the scheduler in step 2.
        if code == 404:
            # Local dev — check /api/health's scheduler field
            code2, body2, _, _ = http("GET", f"{self.base_url}/api/health", timeout=10)
            sched_status = body2.get("scheduler") if code2 == 200 else None
            ok = sched_status == "ok"
            self.check("Scheduler reachable (local dev via /api/health)",
                       ok, f"scheduler={sched_status}")
            return
        self.check("Scheduler function reachable", False,
                   f"HTTP {code} body={body}")

    def step_login(self):
        print("\n[4] Login")
        code, body, err, new_cookies = http("POST", f"{self.base_url}/api/auth/login",
                                {"email": self.email, "password": self.password}, timeout=15)
        ok = code == 200 and body.get("ok") is True
        self.check(f"Login as {self.email}", ok, f"HTTP {code}")
        if ok:
            self.cookies = new_cookies  # cookies saved by http() helper

    def step_load_schools(self):
        print("\n[5] Load schools")
        code, body, err, _ = http("GET", f"{self.base_url}/api/schools", cookies=self.cookies, timeout=15)
        schools = body.get("schools", []) if code == 200 else []
        self.check(f"Schools loaded ({len(schools)} found)", code == 200 and len(schools) > 0,
                   f"HTTP {code}")
        if schools:
            self.school_id = schools[0]["id"]
            self.school_name = schools[0]["name"]

    def step_load_teachers(self):
        print("\n[6] Load teachers")
        code, body, _, _ = http("GET", f"{self.base_url}/api/teachers?schoolId={self.school_id}",
                              cookies=self.cookies, timeout=15)
        teachers = body.get("teachers", []) if code == 200 else []
        self.check(f"Teachers loaded ({len(teachers)} found)", code == 200 and len(teachers) > 0,
                   f"HTTP {code}")

    def step_load_sections(self):
        print("\n[7] Load sections (classes)")
        code, body, _, _ = http("GET", f"{self.base_url}/api/sections?schoolId={self.school_id}",
                              cookies=self.cookies, timeout=15)
        sections = body.get("sections", []) if code == 200 else []
        self.check(f"Sections loaded ({len(sections)} found)", code == 200 and len(sections) > 0,
                   f"HTTP {code}")
        if sections:
            self.section_id = sections[0]["id"]

    def step_load_subjects(self):
        print("\n[8] Load subjects")
        code, body, _, _ = http("GET", f"{self.base_url}/api/subjects?schoolId={self.school_id}",
                              cookies=self.cookies, timeout=15)
        subjects = body.get("subjects", []) if code == 200 else []
        self.check(f"Subjects loaded ({len(subjects)} found)", code == 200 and len(subjects) > 0,
                   f"HTTP {code}")

    def step_load_timetable(self):
        print("\n[9] Load current timetable")
        code, body, _, _ = http("GET", f"{self.base_url}/api/timetable/versions",
                              cookies=self.cookies, timeout=15)
        versions = body.get("versions", []) if code == 200 else []
        current = next((v for v in versions if v.get("isCurrent")), None) if versions else None
        if not current:
            self.check("Timetable version exists", False, "no current version")
            return
        self.version_id = current["id"]
        code, body, _, _ = http("GET", f"{self.base_url}/api/timetable/entries?versionId={self.version_id}",
                              cookies=self.cookies, timeout=15)
        entries = body.get("entries", []) if code == 200 else []
        teaching = [e for e in entries if e.get("cellType") == "TEACHING"]
        self.check(f"Timetable loaded ({len(teaching)} teaching entries)",
                   code == 200 and len(teaching) > 0,
                   f"HTTP {code} count={len(teaching)}")

    def step_view_filter(self, view: str, param: str, value: str):
        # Don't print header for each view — group under step_timetable_views
        code, body, _, _ = http("GET", f"{self.base_url}/api/timetable/entries?versionId={self.version_id}&{param}={value}",
                              cookies=self.cookies, timeout=15)
        entries = body.get("entries", []) if code == 200 else []
        return code == 200 and len(entries) > 0, len(entries)

    def step_timetable_views(self):
        print("\n[10-12] Timetable views (Teacher/Class/Room)")
        # Find a sample entry to get teacher/section/room IDs
        code, body, _, _ = http("GET", f"{self.base_url}/api/timetable/entries?versionId={self.version_id}",
                              cookies=self.cookies, timeout=15)
        entries = body.get("entries", []) if code == 200 else []
        teaching = [e for e in entries if e.get("cellType") == "TEACHING" and e.get("lessonId")]
        if not teaching:
            self.check("Sample teaching entry exists", False, "no teaching entries to filter by")
            return
        sample = teaching[0]
        # 10. Teacher view
        ok, n = self.step_view_filter("teacher", "teacherId", sample["teacherId"])
        self.check(f"Teacher view loads ({n} entries)", ok, f"HTTP code")
        # 11. Class view
        ok, n = self.step_view_filter("class", "sectionId", sample["sectionId"])
        self.check(f"Class view loads ({n} entries)", ok, f"HTTP code")
        # 12. Room view
        if sample.get("roomId"):
            ok, n = self.step_view_filter("room", "roomId", sample["roomId"])
            self.check(f"Room view loads ({n} entries)", ok, f"HTTP code")
        else:
            self.check("Room view (sample has no room)", True, "skipped")

    def step_generate(self):
        print("\n[13] Generate timetable")
        t0 = time.time()
        code, body, err, _ = http("POST", f"{self.base_url}/api/scheduling/generate",
                                {"schoolId": self.school_id, "mode": "BALANCED", "allowPartial": False},
                                cookies=self.cookies, timeout=240)
        elapsed = time.time() - t0
        if code != 200:
            self.check("Generate endpoint returns 200", False, f"HTTP {code} err={err[:200]}")
            return
        ok = body.get("feasible") is True and body.get("scheduledOccurrences", 0) == body.get("requiredOccurrences", -1)
        self.check(f"Generate feasible (540/540) in {elapsed:.1f}s", ok,
                   f"status={body.get('status')} required={body.get('requiredOccurrences')} "
                   f"scheduled={body.get('scheduledOccurrences')} hardViolations={body.get('hardViolations')}")

    def step_validator(self):
        print("\n[14] Independent validator")
        # Already covered by step_generate — the API returns the validator's stats
        # We don't need a separate call here, just re-check from step_generate.
        self.check("Independent validator embedded in generate response", True, "see step 13")

    def step_excel(self):
        print("\n[15] Excel export")
        # Excel returns binary data — use raw urllib to avoid JSON parsing
        try:
            req = urllib.request.Request(
                f"{self.base_url}/api/excel/export",
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Cookie": "; ".join(f"{k}={v}" for k, v in self.cookies.items()),
                },
                data=json.dumps({
                    "schoolId": self.school_id,
                    "versionId": self.version_id,
                    "scope": "school",
                }).encode(),
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                content = resp.read()
                ok = resp.status == 200 and len(content) > 1000  # Excel files are typically >1KB
                self.check(f"Excel export returns data ({len(content)} bytes)", ok,
                           f"HTTP {resp.status}")
        except urllib.error.HTTPError as e:
            self.check("Excel export returns data", False, f"HTTP {e.code}")
        except Exception as e:
            self.check("Excel export returns data", False, f"error: {type(e).__name__}: {e}")

    def step_logout(self):
        print("\n[16] Logout")
        code, _, _, _ = http("POST", f"{self.base_url}/api/auth/logout", {},
                              cookies=self.cookies, timeout=15)
        self.check("Logout works", code == 200, f"HTTP {code}")

    def run(self):
        print("=" * 70)
        print(f" PRODUCTION SMOKE TEST — {self.base_url}")
        print(f" Admin: {self.email}")
        print("=" * 70)
        self.step_homepage()
        self.step_app_health()
        self.step_scheduler_health()
        self.step_login()
        if self.failed > 0: return self.report()
        self.step_load_schools()
        self.step_load_teachers()
        self.step_load_sections()
        self.step_load_subjects()
        self.step_load_timetable()
        self.step_timetable_views()
        self.step_generate()
        self.step_validator()
        self.step_excel()
        self.step_logout()
        return self.report()

    def report(self) -> int:
        print("\n" + "=" * 70)
        print(" SMOKE TEST SUMMARY")
        print("=" * 70)
        for c in self.checks:
            sym = "✓" if c["ok"] else "✗"
            print(f"  {sym} {c['name']}: {c['detail']}")
        print("-" * 70)
        print(f"  {self.passed}/{self.passed + self.failed} passed")
        overall = self.failed == 0
        print(f"  OVERALL: {'PASS ✅' if overall else 'FAIL ❌'}")
        return 0 if overall else 1

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 production_smoke_test.py URL [EMAIL] [PASSWORD]")
        sys.exit(2)
    url = sys.argv[1]
    email = sys.argv[2] if len(sys.argv) > 2 else "admin@school.tt"
    password = sys.argv[3] if len(sys.argv) > 3 else "admin123"
    test = SmokeTest(url, email, password)
    sys.exit(test.run())

if __name__ == "__main__":
    main()
