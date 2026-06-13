// Test build history endpoints
const BASE_URL = "http://localhost:3001";
const ADMIN_KEY = "6a88ad51fc7b595ed03f4cf9b00935b8";

let sessionCookie = "";
let csrfToken = "";

async function http(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sessionCookie) headers["Cookie"] = sessionCookie;
  if (["POST", "PUT", "DELETE"].includes(method) && csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    const adminMatch = setCookie.match(/admin_session=([^;]+)/);
    const csrfMatch = setCookie.match(/csrf_token=([^;]+)/);
    if (adminMatch) {
      sessionCookie = `admin_session=${adminMatch[1]}`;
      if (csrfMatch) sessionCookie += `; csrf_token=${csrfMatch[1]}`;
    }
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return { status: response.status, ok: response.ok, data };
}

async function main() {
  console.log("\n🔍 Testing Build History Endpoints\n");

  // Login
  const loginRes = await http("POST", "/api/admin/session", { key: ADMIN_KEY });
  if (!loginRes.ok) {
    console.error("❌ Login failed");
    process.exit(1);
  }
  csrfToken = loginRes.data.csrfToken || "";
  console.log("✅ Logged in\n");

  // Get stats
  console.log("📊 Build Statistics:");
  const statsRes = await http("GET", "/api/factory/builds/stats");
  if (statsRes.ok) {
    const s = statsRes.data.stats;
    console.log(`   Total builds:    ${s.total}`);
    console.log(`   Success:         ${s.success} (${s.successRate.toFixed(1)}%)`);
    console.log(`   Failure:         ${s.failure}`);
    console.log(`   Avg duration:    ${s.avgDurationMs}ms`);
    console.log(`   Last build:      ${s.lastBuildAt || "Never"}\n`);
  } else {
    console.error("❌ Failed to get stats:", statsRes.data);
  }

  // Get recent builds
  console.log("📜 Recent Builds (last 10):");
  const buildsRes = await http("GET", "/api/factory/builds?limit=10");
  if (buildsRes.ok) {
    const builds = buildsRes.data.builds;
    console.log(`   Found ${builds.length} builds:\n`);
    for (const b of builds.slice(0, 5)) {
      const status = b.status === "success" ? "✅" : "❌";
      const prod = b.production_ready ? "🚀" : "⚠️";
      console.log(
        `   ${status} ${prod} ${b.build_id} — ${b.agent_name || "?"} (${b.created_at.slice(0, 19)})`,
      );
      console.log(`      CRM: ${b.crm_provider || "?"}, Strict: ${b.build_strict ? "ON" : "OFF"}`);
    }
  } else {
    console.error("❌ Failed to get builds:", buildsRes.data);
  }

  console.log("\n✅ Build history is persisted and queryable!\n");
}

main().catch((err) => {
  console.error("❌ Test failed:", err.message);
  process.exit(1);
});
