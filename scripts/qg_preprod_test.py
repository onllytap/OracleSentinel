#!/usr/bin/env python3
# ============================================================================
# OracleSentinel — /QG pre-prod simulation & test harness
# ============================================================================
# Exercises EVERY reachable Command Center (/qg) API path and a pile of edge
# cases, so you can validate the QG before prod without clicking around.
#
# What it covers:
#   - Auth & gating (401 without session, bad key, good key, CSRF on writes)
#   - Every read endpoint (infra, overview, surveillance, workers, db/*,
#     conversations, clients, tenant-owners, passkey/available)
#   - Clients CRUD full lifecycle + validation/edge cases
#   - Chatbot<->client ownership (assign / single-owner move / unassign)
#   - Per-bot config: read, write (prompt/contact/messages), versions, rollback
#   - "Lifecycle" simulations: create a managed bot entry, rename, close/archive
#   - Crash/abuse cases: SQL-injection-ish + XSS strings, oversized fields,
#     malformed JSON, bad ids  -> asserts the server NEVER returns 500
#
# SAFETY:
#   - All test data is namespaced "ZZZ_QGTEST_..." and cleaned up at the end.
#   - It NEVER purges/deletes a tenant that it didn't create itself.
#   - Read-only against everything real; writes only touch its own test rows.
#   - The admin key is read from the QG_ADMIN_KEY env var (never a CLI arg),
#     so the secret never lands in your shell history.
#
# Usage (PowerShell):
#   $env:QG_ADMIN_KEY="<la clé /qg>"; python scripts/qg_preprod_test.py
#   $env:QG_ADMIN_KEY="..."; python scripts/qg_preprod_test.py --base-url https://api.oraclesentinel.com
#
# Stdlib only — no pip install needed. Exit code 0 = all passed, 1 = failures.
# ============================================================================

import argparse
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request

TEST_PREFIX = "ZZZ_QGTEST_"
RUN_TAG = str(int(time.time()))
TEST_TENANT = f"zzz_qgtest_{RUN_TAG}"  # matches ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$


# ── tiny HTTP client (cookie-aware, like a browser session) ─────────────────
class QGClient:
    def __init__(self, base_url):
        self.base = base_url.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )

    def csrf(self):
        for c in self.jar:
            if c.name == "csrf_token":
                return c.value or ""
        return ""

    def request(self, method, path, body=None, with_csrf=True, raw_body=None):
        url = self.base + path
        data = None
        headers = {"Accept": "application/json"}
        if raw_body is not None:
            data = raw_body.encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if method not in ("GET", "HEAD") and with_csrf:
            headers["X-CSRF-Token"] = self.csrf()
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with self.opener.open(req, timeout=30) as resp:
                return resp.status, _parse(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, _parse(e.read())
        except Exception as e:  # network/DNS/timeout
            return 0, {"_error": str(e)}

    def get(self, path):
        return self.request("GET", path)

    def post(self, path, body=None, with_csrf=True, raw_body=None):
        return self.request("POST", path, body=body, with_csrf=with_csrf, raw_body=raw_body)

    def put(self, path, body=None, with_csrf=True):
        return self.request("PUT", path, body=body, with_csrf=with_csrf)

    def delete(self, path, with_csrf=True):
        return self.request("DELETE", path, with_csrf=with_csrf)


def _parse(raw):
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return raw.decode("utf-8", "replace")[:300]


# ── test runner ─────────────────────────────────────────────────────────────
class Runner:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.failures = []

    def check(self, name, ok, detail=""):
        mark = "PASS" if ok else "FAIL"
        line = f"[{mark}] {name}"
        if detail and not ok:
            line += f"  ->  {detail}"
        print(line)
        if ok:
            self.passed += 1
        else:
            self.failed += 1
            self.failures.append(name)

    def no_500(self, name, status, detail=""):
        # A 5xx on any input is a real defect (unhandled crash).
        self.check(name, status != 0 and status < 500, detail or f"status={status}")

    def section(self, title):
        print(f"\n=== {title} ===")


# ── helpers ──────────────────────────────────────────────────────────────────
def get_client_id(payload):
    try:
        return payload["client"]["id"]
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser(description="OracleSentinel /qg pre-prod test harness")
    ap.add_argument("--base-url", default=os.environ.get("QG_BASE_URL", "http://localhost:3001"))
    ap.add_argument("--allow-purge", action="store_true",
                    help="Also test the destructive purge endpoint (only on the test tenant)")
    args = ap.parse_args()

    key = os.environ.get("QG_ADMIN_KEY", "").strip()
    if not key:
        print("ERROR: set QG_ADMIN_KEY env var (the /qg access key). It is never read from argv.")
        sys.exit(2)

    base = args.base_url.rstrip("/")
    print(f"Target: {base}")
    if "api.oraclesentinel.com" in base or base.startswith("https://"):
        print("WARNING: this looks like PRODUCTION. Test data is namespaced + cleaned up, "
              "but prefer a local/staging target for pre-prod testing.")

    r = Runner()
    created_client_ids = []

    # ── 1. Auth & gating (fresh client, no cookies) ──────────────────────────
    r.section("1. Auth & gating")
    anon = QGClient(base)
    for path in ["/api/priv/infra", "/api/priv/clients", "/api/priv/tenant-owners",
                 "/api/admin/db/tenants"]:
        st, _ = anon.get(path)
        r.check(f"GET {path} without session -> 401", st == 401, f"got {st}")

    st, _ = anon.post("/api/admin/session", {"key": "definitely-wrong-key"})
    r.check("login with WRONG key -> 401", st == 401, f"got {st}")

    # ── authenticated client ─────────────────────────────────────────────────
    c = QGClient(base)
    st, _ = c.post("/api/admin/session", {"key": key})
    r.check("login with good key -> 200", st == 200, f"got {st}")
    if st != 200:
        print("\nCannot authenticate — aborting. Check QG_ADMIN_KEY and base URL.")
        _summary(r)
        sys.exit(1)
    r.check("csrf cookie issued after login", bool(c.csrf()))

    st, _ = c.get("/api/admin/status")
    r.check("GET /api/admin/status -> 200", st == 200, f"got {st}")

    # CSRF: a write WITHOUT the token must be refused.
    st, _ = c.post("/api/priv/clients", {"name": TEST_PREFIX + "csrf"}, with_csrf=False)
    r.check("POST /clients WITHOUT csrf -> 403", st == 403, f"got {st}")

    # ── 2. Read endpoints (all 200 with session, never 500) ──────────────────
    r.section("2. Read endpoints")
    reads = [
        "/api/priv/infra", "/api/priv/overview", "/api/priv/surveillance",
        "/api/priv/workers", "/api/priv/clients", "/api/priv/tenant-owners",
        "/api/admin/db/tenants", "/api/admin/db/overview",
        "/api/admin/db/conversations", "/api/admin/passkey/available",
    ]
    for path in reads:
        st, _ = c.get(path)
        r.check(f"GET {path} -> 200", st == 200, f"got {st}")

    # ── 3. Clients CRUD + validation ─────────────────────────────────────────
    r.section("3. Clients CRUD & validation")
    st, body = c.post("/api/priv/clients", {})  # missing name
    r.check("create client WITHOUT name -> 400", st == 400, f"got {st}")

    st, body = c.post("/api/priv/clients", {
        "name": TEST_PREFIX + "Acme", "company": "Acme SAS",
        "email": "contact@acme.test", "siren": "12 345 678 9",
        "status": "active", "dpaSigned": True,
    })
    r.check("create valid client -> 200", st == 200, f"got {st}")
    cid = get_client_id(body)
    if cid:
        created_client_ids.append(cid)
    r.check("created client returns an id", cid is not None)
    if isinstance(body, dict) and body.get("client"):
        r.check("SIREN normalized to digits", body["client"].get("siren") == "123456789",
                f'got {body["client"].get("siren")}')

    st, body = c.get(f"/api/priv/clients/{cid}")
    r.check("GET created client -> 200", st == 200, f"got {st}")

    st, _ = c.get("/api/priv/clients/abc")
    r.check("GET client with non-numeric id -> 400", st == 400, f"got {st}")
    st, _ = c.get("/api/priv/clients/999999999")
    r.check("GET non-existent client -> 404", st == 404, f"got {st}")

    st, body = c.put(f"/api/priv/clients/{cid}", {"status": "prospect", "phone": "0102030405"})
    r.check("update client -> 200", st == 200, f"got {st}")
    if isinstance(body, dict) and body.get("client"):
        r.check("update persisted (status)", body["client"].get("status") == "prospect")

    st, body = c.get("/api/priv/clients")
    in_list = isinstance(body, dict) and any(
        x.get("id") == cid for x in body.get("clients", [])
    )
    r.check("created client appears in list", in_list)

    # ── 4. Chatbot <-> client ownership ──────────────────────────────────────
    r.section("4. Chatbot ownership (assign / move / unassign)")
    st, _ = c.post(f"/api/priv/clients/{cid}/tenants", {"tenantId": "bad id!!"})
    r.check("assign INVALID tenant id -> 400", st == 400, f"got {st}")

    st, _ = c.post(f"/api/priv/clients/{cid}/tenants", {"tenantId": TEST_TENANT})
    r.check("assign test tenant -> 200", st == 200, f"got {st}")

    st, body = c.get("/api/priv/tenant-owners")
    owner_ok = isinstance(body, dict) and body.get("owners", {}).get(TEST_TENANT, {}).get("clientId") == cid
    r.check("tenant-owners maps test tenant -> client", owner_ok,
            f'owners={body.get("owners") if isinstance(body, dict) else body}')

    st, body = c.get(f"/api/priv/clients/{cid}")
    bot_count_ok = isinstance(body, dict) and body.get("client", {}).get("botCount", 0) >= 1
    r.check("client botCount >= 1 after assign", bot_count_ok)

    # Single-owner rule: assign the SAME tenant to a 2nd client -> ownership moves.
    st, body2 = c.post("/api/priv/clients", {"name": TEST_PREFIX + "Beta"})
    cid2 = get_client_id(body2)
    if cid2:
        created_client_ids.append(cid2)
    st, _ = c.post(f"/api/priv/clients/{cid2}/tenants", {"tenantId": TEST_TENANT})
    r.check("re-assign same tenant to 2nd client -> 200", st == 200, f"got {st}")
    st, body = c.get("/api/priv/tenant-owners")
    moved = isinstance(body, dict) and body.get("owners", {}).get(TEST_TENANT, {}).get("clientId") == cid2
    r.check("single-owner: ownership MOVED to 2nd client", moved)

    st, body = c.delete(f"/api/priv/clients/{cid2}/tenants/{TEST_TENANT}")
    r.check("unassign tenant -> 200", st == 200, f"got {st}")

    # ── 5. Per-bot config (the close/CRM-relevant identity & prompt) ─────────
    r.section("5. Per-bot config (prompt / contact / messages / versions)")
    st, body = c.get(f"/api/priv/tenants/{TEST_TENANT}/config")
    r.check("GET tenant config -> 200", st == 200, f"got {st}")
    r.check("config GET returns defaults block", isinstance(body, dict) and "defaults" in body)

    override = {
        "branding": {"agentName": "Léa", "agencyName": TEST_PREFIX + "Agence", "tagline": "On vend vite"},
        "personality": {"writingStyle": "friendly", "toneOfVoice": "warm",
                        "maxResponseWords": 60, "language": "fr",
                        "systemPromptModifiers": ["Propose toujours une visite."],
                        "customInstructions": "Toujours demander le budget avant de proposer un bien."},
        "contact": {"phone": "0102030405", "email": "agence@test.fr",
                    "address": "1 rue de Paris", "website": "https://t.test", "hours": "9h-18h"},
        "messages": {"welcome": "Bonjour 👋", "fallback": "Un conseiller vous rappelle."},
    }
    st, body = c.put(f"/api/priv/tenants/{TEST_TENANT}/config", {"override": override})
    r.check("PUT tenant config -> 200", st == 200, f"got {st}")

    st, body = c.get(f"/api/priv/tenants/{TEST_TENANT}/config")
    saved = body.get("override", {}) if isinstance(body, dict) else {}
    r.check("customInstructions persisted",
            saved.get("personality", {}).get("customInstructions", "").startswith("Toujours demander"))
    r.check("contact persisted", saved.get("contact", {}).get("phone") == "0102030405")
    r.check("effectivePromptBlock is non-empty (prompt really injected)",
            bool((body.get("effectivePromptBlock") or "").strip()) if isinstance(body, dict) else False)

    st, body = c.put(f"/api/priv/tenants/{TEST_TENANT}/config", {"override": {}}, with_csrf=False)
    r.check("PUT tenant config WITHOUT csrf -> 403", st == 403, f"got {st}")

    st, _ = c.get("/api/priv/tenants/bad!id/config")
    r.check("GET config with invalid tenant id -> 400", st == 400, f"got {st}")

    st, body = c.get(f"/api/priv/tenants/{TEST_TENANT}/config/versions")
    versions_ok = isinstance(body, dict) and isinstance(body.get("versions"), list) and len(body["versions"]) >= 1
    r.check("config versions history >= 1", versions_ok)
    if versions_ok and len(body["versions"]) >= 1:
        vid = body["versions"][-1]["id"]
        st, _ = c.post(f"/api/priv/tenants/{TEST_TENANT}/config/rollback", {"versionId": vid})
        r.check("rollback to a previous version -> 200", st == 200, f"got {st}")

    # ── 6. Lifecycle simulations: rename & close/archive ─────────────────────
    r.section("6. Lifecycle: rename & close")
    # "Rename" the bot = change its display agent/agency name via tenant config.
    st, _ = c.put(f"/api/priv/tenants/{TEST_TENANT}/config",
                  {"override": {"branding": {"agentName": "Léa v2", "agencyName": TEST_PREFIX + "Renamed"}}})
    st, body = c.get(f"/api/priv/tenants/{TEST_TENANT}/config")
    renamed = isinstance(body, dict) and body.get("override", {}).get("branding", {}).get("agentName") == "Léa v2"
    r.check("rename bot identity via config -> applied", renamed)
    # "Close" a bot = archive its owning client (soft close, reversible).
    st, body = c.put(f"/api/priv/clients/{cid}", {"status": "archived"})
    closed = st == 200 and isinstance(body, dict) and body.get("client", {}).get("status") == "archived"
    r.check("close/archive client (soft) -> applied", closed)

    # ── 7. Crash / abuse resistance (must NEVER 500) ─────────────────────────
    r.section("7. Crash & abuse resistance (no 500 allowed)")
    # SQL-injection-ish name — parameterized, so it should store fine & not break the table.
    st, body = c.post("/api/priv/clients", {"name": "Robert'); DROP TABLE clients;-- " + RUN_TAG})
    r.no_500("SQLi-style client name handled", st)
    inj_id = get_client_id(body)
    if inj_id:
        created_client_ids.append(inj_id)
    st, _ = c.get("/api/priv/clients")
    r.check("clients table intact after SQLi attempt", st == 200, f"got {st}")

    # XSS string — stored as data, never executed server-side.
    st, _ = c.post("/api/priv/clients", {"name": TEST_PREFIX + "<script>alert(1)</script>"})
    r.no_500("XSS-style client name handled", st)
    st2, b2 = c.get("/api/priv/clients")
    for x in (b2.get("clients", []) if isinstance(b2, dict) else []):
        if x.get("name", "").startswith(TEST_PREFIX + "<script>"):
            created_client_ids.append(x["id"])

    # Oversized field -> must be clamped, not rejected with a crash.
    st, body = c.post("/api/priv/clients", {"name": TEST_PREFIX + ("A" * 5000)})
    r.no_500("oversized client name handled", st)
    if isinstance(body, dict) and body.get("client"):
        created_client_ids.append(body["client"]["id"])
        r.check("oversized name clamped (<=160)", len(body["client"].get("name", "")) <= 160,
                f'len={len(body["client"].get("name",""))}')

    # Oversized customInstructions -> clamped to 2000.
    st, _ = c.put(f"/api/priv/tenants/{TEST_TENANT}/config",
                  {"override": {"personality": {"customInstructions": "B" * 5000}}})
    r.no_500("oversized customInstructions handled", st)
    st, body = c.get(f"/api/priv/tenants/{TEST_TENANT}/config")
    ci = body.get("override", {}).get("personality", {}).get("customInstructions", "") if isinstance(body, dict) else ""
    r.check("customInstructions clamped (<=2000)", len(ci) <= 2000, f"len={len(ci)}")

    # Malformed JSON body -> 400, never 500.
    st, _ = c.post("/api/priv/clients", raw_body="{ not valid json ")
    r.no_500("malformed JSON handled (no 500)", st)
    r.check("malformed JSON -> 400", st == 400, f"got {st}")

    # ── 7.5 Wave 1 endpoints: CRM / billing / provisioning / metrics ─────────
    r.section("7.5 Wave 1 (CRM / billing / provisioning / metrics)")

    # Gating: every new endpoint must require a session (401 when anonymous).
    for path in [
        "/api/priv/billing/plans",
        f"/api/priv/tenants/{TEST_TENANT}/crm",
        f"/api/priv/tenants/{TEST_TENANT}/billing",
        f"/api/priv/tenants/{TEST_TENANT}/metrics",
        "/api/priv/tenants",
    ]:
        st, _ = anon.get(path)
        r.check(f"GET {path} without session -> 401", st == 401, f"got {st}")

    # Billing plans (read-only, public pricing/quotas — no secrets).
    st, body = c.get("/api/priv/billing/plans")
    r.check("GET /billing/plans -> 200", st == 200, f"got {st}")
    plan_ids = (
        sorted([p.get("id") for p in body.get("plans", [])])
        if isinstance(body, dict) else []
    )
    r.check("plans include starter/pro/scale",
            plan_ids == ["pro", "scale", "starter"], f"got {plan_ids}")

    # Per-tenant billing (read-only) + metrics (read-only).
    st, _ = c.get(f"/api/priv/tenants/{TEST_TENANT}/billing")
    r.check("GET tenant billing -> 200", st == 200, f"got {st}")

    st, body = c.get(f"/api/priv/tenants/{TEST_TENANT}/metrics")
    r.check("GET tenant metrics -> 200", st == 200, f"got {st}")
    if isinstance(body, dict):
        rr = body.get("responseRate")
        r.check("responseRate within 0..100",
                isinstance(rr, (int, float)) and 0 <= rr <= 100, f"got {rr}")
        r.check("metrics expose measuredLatencyMs key", "measuredLatencyMs" in body)

    # CRM config: default = provider 'none', no creds, and NEVER leaks a secret.
    st, body = c.get(f"/api/priv/tenants/{TEST_TENANT}/crm")
    r.check("GET tenant crm -> 200", st == 200, f"got {st}")
    r.check("crm default hasCredentials=false",
            isinstance(body, dict) and body.get("hasCredentials") is False)

    secret_marker = "ZZZSECRET" + RUN_TAG
    st, _ = c.put(f"/api/priv/tenants/{TEST_TENANT}/crm", {
        "provider": "webhook", "enabled": False,
        "fieldMappings": {"phone": "tel"},
        "secrets": {"url": "https://example.test/hook",
                    "secret": secret_marker, "headerName": "X-Token"},
    })
    r.check("PUT tenant crm (webhook) -> 200", st == 200, f"got {st}")

    st, body = c.get(f"/api/priv/tenants/{TEST_TENANT}/crm")
    leaked = secret_marker in json.dumps(body) if body is not None else False
    r.check("crm hasCredentials=true after save",
            isinstance(body, dict) and body.get("hasCredentials") is True)
    r.check("crm response NEVER leaks the stored secret", not leaked)

    st, _ = c.put(f"/api/priv/tenants/{TEST_TENANT}/crm",
                  {"provider": "none", "enabled": False}, with_csrf=False)
    r.check("PUT tenant crm WITHOUT csrf -> 403", st == 403, f"got {st}")

    st, _ = c.get("/api/priv/tenants/bad!id/crm")
    r.check("GET crm invalid tenant id -> 400", st == 400, f"got {st}")
    # Reset CRM provider to none (cleanup).
    c.put(f"/api/priv/tenants/{TEST_TENANT}/crm", {"provider": "none", "enabled": False})

    # Provisioning: create a managed agency + copyable embed snippet, lifecycle.
    prov_tid = None
    st, body = c.post("/api/priv/tenants/provision",
                      {"name": TEST_PREFIX + "Agence " + RUN_TAG})
    r.check("provision tenant -> 200", st == 200, f"got {st}")
    if isinstance(body, dict) and body.get("tenant"):
        prov_tid = body["tenant"].get("tenantId")
        wid = body["tenant"].get("widgetId", "")
        r.check("provision returns a widget_id", bool(wid))
        r.check("embed snippet contains the widget_id",
                isinstance(body.get("embedSnippet"), str) and wid in body.get("embedSnippet", ""))

    if prov_tid:
        st, _ = c.post(f"/api/priv/tenants/{prov_tid}/status", {"status": "suspended"})
        r.check("suspend provisioned tenant -> 200", st == 200, f"got {st}")
        st, body = c.get(f"/api/priv/tenants/{prov_tid}")
        r.check("provisioned tenant status=suspended",
                isinstance(body, dict) and body.get("tenant", {}).get("status") == "suspended")
        st, _ = c.post(f"/api/priv/tenants/{prov_tid}/status", {"status": "archived"})
        r.check("archive provisioned tenant -> 200", st == 200, f"got {st}")

    st, _ = c.post("/api/priv/tenants/provision", {})  # missing name
    r.check("provision WITHOUT name -> 400", st == 400, f"got {st}")

    # Stripe webhook (PUBLIC, raw body): an unsigned/bad request must be 400,
    # never 500, and never crash (no STRIPE_WEBHOOK_SECRET -> rejected cleanly).
    st, _ = c.post("/api/billing/webhook",
                   raw_body=json.dumps({"type": "ping"}), with_csrf=False)
    r.no_500("stripe webhook bad signature handled (no 500)", st)
    r.check("stripe webhook bad signature -> 400", st == 400, f"got {st}")

    # ── 7.6 Wave 2: TOTP status / redeploy / SSRF webhook guard ──────────────
    r.section("7.6 Wave 2 (TOTP / redeploy / SSRF guard)")

    # T7 — TOTP endpoints exist, are session-gated, and NOT enrolled by default.
    # (The ADMIN_API_KEY login itself is validated in section 1 — proving T7 did
    #  NOT break the existing key login while TOTP is inactive.)
    st, _ = anon.get("/api/admin/totp/status")
    r.check("GET /api/admin/totp/status without session -> 401", st == 401, f"got {st}")
    st, body = c.get("/api/admin/totp/status")
    r.check("GET /api/admin/totp/status -> 200", st == 200, f"got {st}")
    r.check("TOTP not enrolled/activated by default",
            isinstance(body, dict) and body.get("enrolled") is False and body.get("activated") is False)

    # T9 — redeploy state read + confirmation-gated, CSRF-protected trigger.
    st, body = c.get(f"/api/priv/tenants/{TEST_TENANT}/redeploy")
    r.check("GET tenant redeploy state -> 200", st == 200, f"got {st}")
    r.check("redeploy state has a status",
            isinstance(body, dict) and isinstance(body.get("state"), dict) and "status" in body["state"])
    st, _ = c.post(f"/api/priv/tenants/{TEST_TENANT}/redeploy", {})  # missing confirm
    r.check("redeploy WITHOUT confirm -> 400", st == 400, f"got {st}")
    st, _ = c.post(f"/api/priv/tenants/{TEST_TENANT}/redeploy", {"confirm": True}, with_csrf=False)
    r.check("redeploy WITHOUT csrf -> 403", st == 403, f"got {st}")
    st, body = c.post(f"/api/priv/tenants/{TEST_TENANT}/redeploy", {"confirm": True})
    r.no_500("redeploy with confirm handled (no 500)", st)
    r.check("redeploy with confirm -> 200", st == 200, f"got {st}")

    # T8 — SSRF guard on the webhook tester: a cloud-metadata target MUST be
    # blocked (422), never fetched, never 500.
    st, _ = c.post("/api/factory/test/webhook", {"url": "http://169.254.169.254/latest/meta-data/"})
    r.no_500("SSRF metadata URL handled (no 500)", st)
    r.check("SSRF metadata URL blocked -> 422", st == 422, f"got {st}")
    st, _ = c.post("/api/factory/test/webhook", {"url": "file:///etc/passwd"})
    r.no_500("SSRF file:// scheme handled (no 500)", st)
    r.check("SSRF non-http scheme blocked -> 422", st == 422, f"got {st}")

    # ── 8. Optional destructive purge (test tenant only) ─────────────────────
    if args.allow_purge:
        r.section("8. Purge (test tenant only)")
        st, _ = c.delete(f"/api/admin/db/tenant/{TEST_TENANT}")
        r.no_500("purge test tenant handled", st)

    # ── cleanup ──────────────────────────────────────────────────────────────
    r.section("Cleanup")
    # Reset the test tenant's config to empty (no delete endpoint -> empty override).
    c.put(f"/api/priv/tenants/{TEST_TENANT}/config", {"override": {}})
    deleted = 0
    for cid_ in set(created_client_ids):
        st, _ = c.delete(f"/api/priv/clients/{cid_}")
        if st == 200:
            deleted += 1
    print(f"Cleaned up {deleted}/{len(set(created_client_ids))} test client(s); reset test tenant config.")

    _summary(r)
    sys.exit(1 if r.failed else 0)


def _summary(r):
    print("\n" + "=" * 60)
    print(f"RESULT: {r.passed} passed, {r.failed} failed")
    if r.failures:
        print("Failures:")
        for f in r.failures:
            print(f"  - {f}")
    print("=" * 60)


if __name__ == "__main__":
    main()
