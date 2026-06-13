import { pool } from "../db/pool";
import { createChildLogger } from "../utils/logger";

const log = createChildLogger("admin-utils");

export const ALLOWED_ADMIN_COUNT_TABLES = [
  "catalog_properties",
  "catalog_import_runs",
  "conversations",
  "messages",
  "leads",
] as const;

export type AllowedAdminCountTable = (typeof ALLOWED_ADMIN_COUNT_TABLES)[number];

export function isAllowedAdminCountTable(
  table: string,
): table is AllowedAdminCountTable {
  return (ALLOWED_ADMIN_COUNT_TABLES as readonly string[]).includes(table);
}

export async function safeCount(
  table: AllowedAdminCountTable,
  where?: string,
  params?: unknown[],
): Promise<number> {
  if (!isAllowedAdminCountTable(table)) {
    log.warn({ table }, "Rejected count query for disallowed table");
    return 0;
  }

  try {
    const sql = where
      ? `SELECT COUNT(*)::int AS c FROM "${table}" WHERE ${where}`
      : `SELECT COUNT(*)::int AS c FROM "${table}"`;
    const result = await pool.query(sql, params || []);
    return result.rows[0]?.c ?? 0;
  } catch (err) {
    log.warn({ err, table, where }, "Admin count query failed");
    return 0;
  }
}
