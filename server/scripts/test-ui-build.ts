// ============================================================================
// UI Build Test — Simulates real UI workflow with CRM=twenty + Strict=true
// ============================================================================
// Tests the exact flow that a user would perform in the Factory UI:
// 1. Login with admin key
// 2. Load current config
// 3. Modify: CRM=twenty, Strict=true, CRM_STRICT_CUSTOM_FIELDS=true
// 4. Save config (PUT /api/factory/config)
// 5. Build agent (POST /api/factory/build {})
// 6. Verify success
// ============================================================================

const BASE_URL = "http://localhost:3001";
const ADMIN_KEY =
  process.env.ADMIN_API_KEY || "6a88ad51fc7b595ed03f4cf9b00935b8";

let sessionCookie = "";
let csrfToken = "";

async function http(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; ok: boolean; data: any; headers: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sessionCookie) {
    headers["Cookie"] = sessionCookie;
  }
  // Add CSRF token for mutation requests
  if (["POST", "PUT", "DELETE"].includes(method) && csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Capture session cookie + CSRF token from Set-Cookie headers
  const setCookieHeader = response.headers.get("set-cookie");
  if (setCookieHeader) {
    const adminMatch = setCookieHeader.match(/admin_session=([^;]+)/);
    const csrfMatch = setCookieHeader.match(/csrf_token=([^;]+)/);
    if (adminMatch) {
      sessionCookie = `admin_session=${adminMatch[1]}`;
      if (csrfMatch) {
        csrfToken = csrfMatch[1];
        sessionCookie += `; csrf_token=${csrfMatch[1]}`;
      }
    }
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
    headers: {},
  };
}

async function main() {
  console.log("\n" + "=".repeat(72));
  console.log("  🧪 UI BUILD TEST — CRM=twenty + Strict=true");
  console.log("=".repeat(72) + "\n");

  // ── Step 1: Login ──────────────────────────────────────────────
  console.log("▶️  Step 1: Admin login...");
  const loginRes = await http("POST", "/api/admin/session", { key: ADMIN_KEY });
  if (!loginRes.ok || !loginRes.data.success) {
    console.error("❌ Login failed:", loginRes.data);
    process.exit(1);
  }
  // CSRF token is now captured from Set-Cookie header automatically
  if (!csrfToken) {
    console.error(
      "⚠️  Warning: No CSRF token captured from cookie — mutations may fail",
    );
  }
  console.log(
    `✅ Logged in (CSRF token: ${csrfToken ? "captured from cookie" : "MISSING"})\n`,
  );

  // ── Step 2: Load current config ────────────────────────────────
  console.log("▶️  Step 2: Load current config...");
  const configRes = await http("GET", "/api/factory/config");
  if (!configRes.ok) {
    console.error("❌ Failed to load config:", configRes.data);
    process.exit(1);
  }
  const config = configRes.data.config;
  console.log(`✅ Config loaded (agent: ${config.agentName})\n`);

  // ── Step 3: Modify config ──────────────────────────────────────
  console.log("▶️  Step 3: Modify config (CRM=twenty, Strict=true)...");
  config.crm.provider = "twenty";
  config.crm.strict.customFields = true;
  config.factory.buildStrict = true;

  // ── Step 4: Save config ────────────────────────────────────────
  console.log("▶️  Step 4: Save config (PUT /api/factory/config)...");
  const saveRes = await http("PUT", "/api/factory/config", { config });
  if (!saveRes.ok || !saveRes.data.success) {
    console.error("❌ Save failed:", saveRes.data);
    process.exit(1);
  }
  console.log("✅ Config saved\n");

  // ── Step 5: Build agent ────────────────────────────────────────
  console.log("▶️  Step 5: Build agent (POST /api/factory/build {})...");
  const buildRes = await http("POST", "/api/factory/build", {});

  const build = buildRes.data?.build;
  if (!build) {
    console.error("❌ Build response has no build object:", buildRes.data);
    process.exit(1);
  }

  console.log(`\n   Build ID: ${build.buildId}`);
  console.log(`   Status: ${build.status}`);
  console.log(`   Production Ready: ${build.productionReady}`);
  console.log(`   Agent: ${build.agentName}\n`);

  // Print steps
  console.log("   ── Build Steps ──");
  for (const step of build.steps || []) {
    const icon =
      step.status === "success"
        ? "✅"
        : step.status === "warning"
          ? "⚠️"
          : step.status === "failure"
            ? "❌"
            : "⏳";
    console.log(
      `   ${icon} ${step.name.padEnd(35)} ${step.status.padEnd(10)} ${step.message || ""}`,
    );
  }

  // Print warnings/errors
  if (build.warnings?.length > 0) {
    console.log("\n   ⚠️  Warnings:");
    for (const w of build.warnings) {
      console.log(`   - ${w}`);
    }
  }
  if (build.errors?.length > 0) {
    console.log("\n   ❌ Errors:");
    for (const e of build.errors) {
      console.log(`   - ${e}`);
    }
  }

  // ── Step 6: Verify result ──────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  if (build.status === "success") {
    console.log("  ✅ UI BUILD TEST: PASS");
    console.log(`  Build ${build.buildId} succeeded with:`);
    console.log(`    - CRM: twenty`);
    console.log(`    - Strict Mode: ON`);
    console.log(`    - CRM Strict Custom Fields: ON`);
    console.log(`    - Production Ready: ${build.productionReady}`);
  } else {
    console.log("  ❌ UI BUILD TEST: FAIL");
    console.log(`  Build ${build.buildId} failed`);
    console.log(`  Status: ${build.status}`);
    console.log(`  Errors: ${build.errors?.length || 0}`);
  }
  console.log("=".repeat(72) + "\n");

  process.exit(build.status === "success" ? 0 : 1);
}

main().catch((err) => {
  console.error("\n❌ Test crashed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
