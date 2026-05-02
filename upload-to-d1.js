#!/usr/bin/env node

/**
 * upload-to-d1.js
 * Upload 4 CSV files into a Cloudflare D1 database using Wrangler.
 *
 * Usage:
 *   node upload-to-d1.js --db <DATABASE_NAME_OR_ID> [--batch 50] [--dry-run]
 *
 * Requirements:
 *   npm install csv-parse
 *   npx wrangler login  (first time)
 */

import { execSync }                                          from "child_process";
import { createReadStream, existsSync, writeFileSync,
         unlinkSync }                                        from "fs";
import { parse }                                             from "csv-parse";
import path                                                  from "path";
import { fileURLToPath }                                     from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CLI Args ──────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const getArg     = (flag, def) => { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : def; };
const DB_NAME    = getArg("--db", null);
const BATCH_SIZE = parseInt(getArg("--batch", "50"), 10);
const DRY_RUN    = args.includes("--dry-run");

if (!DB_NAME) {
  console.error("❌  Usage: node upload-to-d1.js --db <DATABASE_NAME_OR_ID> [--batch 50] [--dry-run]");
  process.exit(1);
}

// ─── Table definitions ─────────────────────────────────────────────────────────
const TABLE_DEFS = [
  {
    table: "category",
    file:  path.join(__dirname, "category.csv"),
    columns: ["id", "name"],
    createSQL: `CREATE TABLE IF NOT EXISTS category (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );`,
  },
  {
    table: "dua_names",
    file:  path.join(__dirname, "duanames.csv"),
    columns: ["dua_global_id", "book_id", "chap_id", "dua_id", "chapname", "duaname", "tags", "ID", "category"],
    createSQL: `CREATE TABLE IF NOT EXISTS dua_names (
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
    );`,
  },
  {
    table: "dua_details",
    file:  path.join(__dirname, "duadetails.csv"),
    columns: [
      "book_id", "dua_global_id", "ID", "dua_segment_id",
      "top", "arabic_diacless", "arabic",
      "transliteration", "translations", "bottom",
      "reference", "app_reference",
    ],
    createSQL: `CREATE TABLE IF NOT EXISTS dua_details (
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
    );`,
  },
  {
    table: "dua_wbw",
    file:  path.join(__dirname, "duawbw.csv"),
    columns: ["dua_global_id", "dua_segment_id", "word_id", "arabic", "bn"],
    createSQL: `CREATE TABLE IF NOT EXISTS dua_wbw (
      dua_global_id  INTEGER,
      dua_segment_id INTEGER,
      word_id        INTEGER,
      arabic         TEXT,
      bn             TEXT,
      PRIMARY KEY (dua_global_id, dua_segment_id, word_id),
      FOREIGN KEY (dua_global_id) REFERENCES dua_names(dua_global_id)
    );`,
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on("data",  (row) => rows.push(row))
      .on("end",   ()    => resolve(rows))
      .on("error", reject);
  });
}

function escapeValue(val) {
  const s = val === null || val === undefined ? "" : String(val).trim();
  if (s === "" || s === "NaN") return "NULL";
  return `'${s.replace(/'/g, "''")}'`;
}

function buildInsertSQL(table, columns, rows) {
  const colList = columns.join(", ");
  const values  = rows
    .map((row) => `(${columns.map((c) => escapeValue(row[c])).join(", ")})`)
    .join(",\n");
  return `INSERT OR REPLACE INTO ${table} (${colList}) VALUES\n${values};`;
}

function runSQL(sql, label) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] ${label}: ${sql.slice(0, 100).replace(/\n/g, " ")}...`);
    return;
  }
  const tmp = `/tmp/d1_${Date.now()}_${Math.random().toString(36).slice(2)}.sql`;
  writeFileSync(tmp, sql, "utf8");
  try {
    execSync(
      `npx wrangler d1 execute "${DB_NAME}" --file="${tmp}" --remote`,
      { stdio: "pipe", encoding: "utf8" }
    );
  } catch (err) {
    console.error(`\n❌  Wrangler error [${label}]:`);
    console.error(err.stderr || err.message);
    throw err;
  } finally {
    try { unlinkSync(tmp); } catch (_) {}
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🚀  Cloudflare D1 CSV Uploader");
  console.log(`   Database : ${DB_NAME}`);
  console.log(`   Batch    : ${BATCH_SIZE} rows per execute`);
  console.log(`   Mode     : ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}\n`);

  // Step 1 — Create tables
  console.log("📦  Creating tables...");
  for (const def of TABLE_DEFS) {
    process.stdout.write(`   ${def.table.padEnd(16)} → `);
    runSQL(def.createSQL, `CREATE ${def.table}`);
    console.log("✔");
  }

  // Step 2 — Upload each CSV
  for (const def of TABLE_DEFS) {
    const { table, file, columns } = def;

    if (!existsSync(file)) {
      console.warn(`\n⚠️   File not found, skipping: ${file}`);
      continue;
    }

    console.log(`\n📂  ${path.basename(file)}  →  [${table}]`);
    const rows = await parseCSV(file);
    console.log(`   ${rows.length} rows found`);

    runSQL(`DELETE FROM ${table};`, `DELETE ${table}`);
    console.log("   Cleared existing rows");

    const total = rows.length;
    let inserted = 0;
    const t0 = Date.now();

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      runSQL(buildInsertSQL(table, columns, chunk), `${table} batch ${i}`);
      inserted += chunk.length;

      const pct = ((inserted / total) * 100).toFixed(1);
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      process.stdout.write(`\r   ⏳  ${inserted}/${total} (${pct}%) — ${sec}s   `);
    }

    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n   ✅  Done in ${sec}s`);
  }

  console.log("\n🎉  All done!");
  if (DRY_RUN) console.log("   (DRY RUN — nothing was written)\n");
}

main().catch((err) => {
  console.error("\n💥  Fatal:", err.message || err);
  process.exit(1);
});
