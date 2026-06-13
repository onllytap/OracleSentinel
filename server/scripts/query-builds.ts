// Query builds directly from PostgreSQL
import { pool } from "../src/db/pool";

async function main() {
  console.log("\n📊 Factory Builds in Database:\n");

  try {
    const result = await pool.query(`
      SELECT COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE status = 'success')::int as success,
             COUNT(*) FILTER (WHERE status = 'failure')::int as failure
      FROM factory_builds
    `);

    const stats = result.rows[0];
    console.log(`   Total builds: ${stats.total}`);
    console.log(`   Success:      ${stats.success}`);
    console.log(`   Failure:      ${stats.failure}\n`);

    if (stats.total > 0) {
      const builds = await pool.query(`
        SELECT build_id, agent_name, status, production_ready, crm_provider,
               build_strict, duration_ms, created_at
        FROM factory_builds
        ORDER BY created_at DESC
        LIMIT 5
      `);

      console.log("Last 5 builds:");
      for (const b of builds.rows) {
        const status = b.status === "success" ? "✅" : "❌";
        const prod = b.production_ready ? "🚀" : "⚠️";
        const agentName = b.agent_name || "?";
        const crmProvider = b.crm_provider || "?";
        const strict = b.build_strict ? "ON" : "OFF";
        const duration = b.duration_ms || 0;
        const created = b.created_at.toISOString().slice(0, 19);

        console.log(`   ${status} ${prod} ${b.build_id}`);
        console.log(`      Agent: ${agentName}`);
        console.log(`      CRM: ${crmProvider}, Strict: ${strict}`);
        console.log(`      Duration: ${duration}ms, Created: ${created}\n`);
      }
    } else {
      console.log("⚠️  No builds found in database. Run a build first.\n");
    }
  } catch (err: any) {
    console.error("❌ Query failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
