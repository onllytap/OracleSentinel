// Run migration for factory_builds table
import { pool } from "../src/db/pool";
import fs from "fs";
import path from "path";

async function main() {
  console.log("Running migration: 002_factory_builds.sql");

  const migrationPath = path.join(__dirname, "../src/db/migrations/002_factory_builds.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  try {
    await pool.query(sql);
    console.log("✅ Migration completed successfully");
    console.log("   Table 'factory_builds' created with indexes");
  } catch (err: any) {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
