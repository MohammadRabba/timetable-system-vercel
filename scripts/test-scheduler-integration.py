"""Quick integration test — pulls data from Next.js API, posts to scheduler, prints result."""
import json
import sys
import time
import urllib.request

# Get session cookie via login
login_data = json.dumps({"email": "admin@school.tt", "password": "admin123"}).encode()
req = urllib.request.Request("http://localhost:3000/api/auth/login",
                              data=login_data,
                              headers={"Content-Type": "application/json"})
resp = urllib.request.urlopen(req)
cookies = resp.headers.get("Set-Cookie")
cookie = cookies.split(";")[0] if cookies else ""
print(f"Cookie: {cookie[:30]}...")

# Get school ID
req = urllib.request.Request("http://localhost:3000/api/schools",
                              headers={"Cookie": cookie})
resp = urllib.request.urlopen(req)
schools = json.loads(resp.read())
school_id = schools["schools"][0]["id"]
print(f"School ID: {school_id}")

# Call Next.js generate endpoint — it will proxy to the Python scheduler
t0 = time.time()
gen_data = json.dumps({"schoolId": school_id, "mode": "FAST", "allowPartial": True}).encode()
req = urllib.request.Request("http://localhost:3000/api/scheduling/generate",
                              data=gen_data,
                              headers={"Content-Type": "application/json", "Cookie": cookie})
try:
    resp = urllib.request.urlopen(req, timeout=120)
    body = resp.read().decode()
    elapsed = time.time() - t0
    d = json.loads(body)
    print(f"\n=== GENERATE RESULT ({elapsed:.1f}s) ===")
    print(f"Provider: {d.get('provider')}")
    print(f"Status: {d.get('status')}")
    print(f"Feasible: {d.get('feasible')}")
    print(f"Partial: {d.get('partial')}")
    print(f"Quality: {d.get('qualityScore')}")
    print(f"Soft penalty: {d.get('softPenalty')}")
    print(f"Required: {d.get('requiredOccurrences')}")
    print(f"Scheduled: {d.get('scheduledOccurrences')}")
    print(f"Unscheduled: {d.get('unscheduledOccurrences')}")
    print(f"Hard violations: {d.get('hardViolations')}")
    print(f"Conflicts: {len(d.get('conflicts', []))}")
    print(f"Failures: {len(d.get('failures', []))}")
    t = d.get("timing", {})
    print(f"Timing: model={t.get('modelGenerationMs')}ms, solver={t.get('solverMs')}ms, wall={t.get('wallMs')}ms, mem={t.get('memoryMb')}MB")
    if d.get("error"):
        print(f"Error: {d['error']}")
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"HTTP {e.code}: {body[:500]}")
except Exception as e:
    print(f"Error: {type(e).__name__}: {e}")
