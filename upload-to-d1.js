#!/usr/bin/env node

import { execSync } from "child_process";
import { createReadStream, existsSync } from "fs";
import { parse } from "csv-parse";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CLI Args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, defaultVal) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : defaultVal;
};
const DB_NAME   = getArg("--db", null);
const BATCH_SIZE = parseInt(getArg("--batch", "50"), 10); // rows per D1 execute call
const DRY_RUN   = args.includes("--dry-run");

if (!DB_NAME) {
  console.error("❌  Usage: node upload-to-d1.js --db <DATABASE_NAME_OR_ID> [--batch 50] [--dry-run]");
  process.exit(1);
}

// ─── CSV file definitions ─────────────────────────────────────────────────────
const CSV_DIR = path.resolve(__dirname); // place CSVs beside this script, or edit path

const TABLE_DEFS = [
  {
    table: "category",
    file:  path.join(CSV_DIR, "category.csv"),
    columns: ["id", "name"],
    createSQL: `
      CREATE TABLE IF NOT EXISTS category (
        id   INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );
    `,
  },
  {
    table: "dua_names",
    file:  path.join(CSV_DIR, "duanames.csv"),
    columns: ["dua_global_id", "book_id", "chap_id", "dua_id", "chapname", "duaname", "tags", "ID", "category"],
    createSQL: `
      CREATE TABLE IF NOT EXISTS dua_names (
        dua_global_id INTEGER PRIMARY KEY,
        book_id       INTEGER,
        chap_id       INTEGER,
        dua_id        REAL,
        chapname      TEXT,
        duaname       TEXT,
        tags          TEXT,
        ID            REAL,
        category      INTEGER,
        FOREIGN KEY (category) REFERENCES category(id)
      );
    `,
  },
  {
    table: "dua_details",
    file:  path.join(CSV_DIR, "duadetails.csv"),
    columns: [
      "book_id", "dua_global_id", "ID", "dua_segment_id",
      "top", "arabic_diacless", "arabic",
      "transliteration", "translations", "bottom",
      "reference", "app_reference",
    ],
    createSQL: `
      CREATE TABLE IF NOT EXISTS dua_details (
        book_id         INTEGER,
        dua_global_id   INTEGER,
        ID              INTEGER,
        dua_segment_id  INTEGER,
        top             TEXT,
        arabic_diacless TEXT,
        arabic          TEXT,
        transliteration REAL,
        translations    TEXT,
        bottom          REAL,
        reference       TEXT,
        app_reference   REAL,
        PRIMARY KEY (dua_global_id, dua_segment_id),
        FOREIGN KEY (dua_global_id) REFERENCES dua_names(dua_global_id)
      );
    `,
  },
  {
    table: "dua_wbw",
    file:  path.join(CSV_DIR, "duawbw.csv"),
    columns: ["dua_global_id", "dua_segment_id", "word_id", "arabic", "bn"],
    createSQL: `
      CREATE TABLE IF NOT EXISTS dua_wbw (
        dua_global_id  INTEGER,
        dua_segment_id INTEGER,
        word_id        INTEGER,
        arabic         TEXT,
        bn             TEXT,
        PRIMARY KEY (dua_global_id, dua_segment_id, word_id),
        FOREIGN KEY (dua_global_id) REFERENCES dua_names(dua_global_id)
      );
    `,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a CSV file → array of row-objects */
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on("data", (row) => rows.push(row))
      .on("end",  () => resolve(rows))
      .on("error", reject);
  });
}

/** Escape a value for SQLite string literal */
function escapeValue(val) {
  if (val === null || val === undefined || val === "" || val === "NaN") return "NULL";
  const s = String(val).replace(/'/g, "''");
  return `'${s}'`;
}

/** Build an INSERT OR REPLACE SQL statement for a batch of rows */
function buildInsertSQL(table, columns, rows) {
  const colList = columns.join(", ");
  const valuesList = rows.map((row) => {
    const vals = columns.map((col) => escapeValue(row[col]));
    return `(${vals.join(", ")})`;
  });
  return `INSERT OR REPLACE INTO ${table} (${colList}) VALUES ${valuesList.join(",\n")};`;
}

/** Run a single SQL string through wrangler d1 execute */
function wranglerExec(sql) {
  if (DRY_RUN) {
    console.log("  [DRY-RUN] SQL preview (first 200 chars):", sql.slice(0, 200).replace(/\n/g, " "));
    return;
  }

  // Write SQL to a temp file to avoid shell-escaping issues with Unicode
  const tmpFile = path.join("/tmp", `d1_batch_${Date.now()}.sql`);
  const { writeFileSync, unlinkSync } = await import("fs"); // static import at top in real usage
  writeFileSync(tmpFile, sql, "utf8");

  try {
    execSync(
      `npx wrangler d1 execute ${DB_NAME} --file=${tmpFile} --remote`,
      { stdio: "pipe", encoding: "utf8" }
    );
  } finally {
    try { unlinkSync(tmpFile); } catch (_) {}
  }
}

// Because top-level await needs ESM, wrap everything in an async main()
// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Lazy import writeFileSync / unlinkSync here (ESM compatible)
  const { writeFileSync, unlinkSync } = await import("fs");

  /** Write SQL to temp file and execute via wrangler */
  async function execSQL(sql, label) {
    if (DRY_RUN) {
      console.log(`    [DRY-RUN] ${label} — preview: ${sql.slice(0, 120).replace(/\n/g, " ")}`);
      return;
    }
    const tmpFile = `/tmp/d1_upload_${Date.now()}_${Math.random().toString(36).slice(2)}.sql`;
    writeFileSync(tmpFile, sql, "utf8");
    try {
      execSync(
        `npx wrangler d1 execute "${DB_NAME}" --file="${tmpFile}" --remote`,
        { stdio: "pipe", encoding: "utf8" }
      );
    } catch (err) {
      console.error(`\n❌  Wrangler error on [${label}]:`);
      console.error(err.stderr || err.message);
      throw err;
    } finally {
      try { unlinkSync(tmpFile); } catch (_) {}
    }
  }

  console.log(`\n🚀  Cloudflare D1 CSV Uploader`);
  console.log(`   Database : ${DB_NAME}`);
  console.log(`   Batch    : ${BATCH_SIZE} rows per execute`);
  console.log(`   Mode     : ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}\n`);

  // ── Step 1: Create all tables ───────────────────────────────────────────────
  console.log("📦  Creating tables...");
  for (const def of TABLE_DEFS) {
    process.stdout.write(`   ${def.table.padEnd(16)} → `);
    await execSQL(def.createSQL.trim(), `CREATE ${def.table}`);
    console.log("✔  created / already exists");
  }

  // ── Step 2: Upload each table ───────────────────────────────────────────────
  for (const def of TABLE_DEFS) {
    const { table, file, columns } = def;

    if (!existsSync(file)) {
      console.warn(`\n⚠️   File not found, skipping: ${file}`);
      continue;
    }

    console.log(`\n📂  Loading ${path.basename(file)} → [${table}]`);
    const rows = await parseCSV(file);
    console.log(`   ${rows.length} rows found.`);

    // Clear existing data before re-upload
    await execSQL(`DELETE FROM ${table};`, `DELETE ${table}`);
    console.log(`   Cleared old data.`);

    let inserted = 0;
    const total = rows.length;
    const startTime = Date.now();

    // Process in chunks
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const sql = buildInsertSQL(table, columns, chunk);
      await execSQL(sql, `INSERT ${table} rows ${i}–${i + chunk.length - 1}`);

      inserted += chunk.length;
      const pct = ((inserted / total) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(
        `\r   Progress: ${inserted}/${total} rows (${pct}%) — ${elapsed}s elapsed   `
      );
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n   ✅  ${inserted} rows inserted into [${table}] in ${elapsed}s`);
  }

  console.log("\n🎉  All tables uploaded successfully!");
  if (DRY_RUN) console.log("     (DRY RUN — no actual changes were made)\n");
}

main().catch((err) => {
  console.error("\n💥  Fatal error:", err.message || err);
  process.exit(1);
});
