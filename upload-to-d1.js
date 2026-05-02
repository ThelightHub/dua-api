#!/usr/bin/env node

/**
 * upload-to-d1.js
 * Upload Dua CSV files into Cloudflare D1 via Wrangler.
 *
 * Usage:
 *   node upload-to-d1.js --db <DATABASE_NAME> [--batch 50] [--dry-run]
 *
 * Requirements:
 *   npm install csv-parse
 *   npx wrangler login
 */

import { execSync }                                                from "child_process";
import { createReadStream, existsSync, writeFileSync, unlinkSync } from "fs";
import { parse }                                                   from "csv-parse";
import path                                                        from "path";
import { fileURLToPath }                                           from "url";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const args       = process.argv.slice(2);
const getArg     = (f, d) => { const i = args.indexOf(f); return i !== -1 && args[i+1] ? args[i+1] : d; };
const DB_NAME    = getArg("--db", null);
const BATCH_SIZE = parseInt(getArg("--batch", "25"), 10);
const DRY_RUN    = args.includes("--dry-run");

// D1 max file size per execute call (kept well under 1MB limit)
const MAX_SQL_BYTES = 700_000;

if (!DB_NAME) {
  console.error("❌  Usage: node upload-to-d1.js --db <DATABASE_NAME> [--batch 25] [--dry-run]");
  process.exit(1);
}

// ─── Schema ───────────────────────────────────────────────────────────────────
const CREATE_SQL = `
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS category (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dua_names (
  dua_global_id INTEGER PRIMARY KEY,
  book_id       INTEGER,
  chap_id       INTEGER,
  dua_id        REAL,
  chapname      TEXT,
  duaname       TEXT,
  tags          TEXT,
  ID            REAL
);

CREATE TABLE IF NOT EXISTS dua_name_category (
  dua_global_id INTEGER NOT NULL,
  category_id   INTEGER NOT NULL,
  PRIMARY KEY (dua_global_id, category_id)
);

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
  PRIMARY KEY (dua_global_id, dua_segment_id)
);

CREATE TABLE IF NOT EXISTS dua_wbw (
  dua_global_id  INTEGER,
  dua_segment_id INTEGER,
  word_id        INTEGER,
  arabic         TEXT,
  bn             TEXT,
  PRIMARY KEY (dua_global_id, dua_segment_id, word_id)
);
`.trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on("data",  (r) => rows.push(r))
      .on("end",   ()  => resolve(rows))
      .on("error", reject);
  });
}

function esc(val) {
  const s = (val === null || val === undefined) ? "" : String(val).trim();
  if (s === "" || s.toLowerCase() === "nan") return "NULL";
  return `'${s.replace(/'/g, "''")}'`;
}

/** Build individual INSERT statements (one per row) — avoids multi-row TOOBIG */
function buildInserts(table, columns, rows) {
  const cols = columns.join(", ");
  return rows.map(r => {
    const vals = columns.map(c => esc(r[c])).join(", ");
    return `INSERT OR REPLACE INTO ${table} (${cols}) VALUES (${vals});`;
  }).join("\n");
}

/** Split rows into size-safe chunks based on estimated SQL byte size */
function splitBySize(table, columns, rows) {
  const chunks = [];
  let current = [];
  let currentSize = 0;
  const cols = columns.join(", ");

  for (const row of rows) {
    const vals = columns.map(c => esc(row[c])).join(", ");
    const stmt = `INSERT OR REPLACE INTO ${table} (${cols}) VALUES (${vals});\n`;
    const stmtSize = Buffer.byteLength(stmt, "utf8");

    if (currentSize + stmtSize > MAX_SQL_BYTES && current.length > 0) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(row);
    currentSize += stmtSize;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function runSQL(sql, label) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] ${label} (${Buffer.byteLength(sql, "utf8")} bytes)`);
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
    const msg = (err.stderr || err.message || "").toString();
    console.error(`\n❌  Wrangler error [${label}]: ${msg.split("\n").find(l => l.includes("ERROR")) || msg.slice(0, 200)}`);
    throw err;
  } finally {
    try { unlinkSync(tmp); } catch (_) {}
  }
}

function uploadTable(table, columns, rows) {
  if (rows.length === 0) {
    console.log("   (no rows)");
    return;
  }

  // Split into size-safe chunks (respects MAX_SQL_BYTES per wrangler call)
  const chunks = splitBySize(table, columns, rows);
  const total  = rows.length;
  let inserted = 0;
  const t0     = Date.now();

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const sql   = buildInserts(table, columns, chunk);
    runSQL(sql, `${table} chunk ${ci + 1}/${chunks.length}`);
    inserted += chunk.length;
    const pct = ((inserted / total) * 100).toFixed(1);
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(`\r   ⏳  ${inserted}/${total} (${pct}%) — ${sec}s   `);
  }

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n   ✅  ${inserted} rows in ${sec}s`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🚀  Cloudflare D1 CSV Uploader");
  console.log(`   Database : ${DB_NAME}`);
  console.log(`   Mode     : ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  // 1. Create tables
  console.log("📦  Creating tables...");
  runSQL(CREATE_SQL, "CREATE all tables");
  console.log("   ✔  All tables ready\n");

  // 2. category
  console.log("📂  category.csv → [category]");
  const catRows = await parseCSV(path.join(__dirname, "category.csv"));
  console.log(`   ${catRows.length} rows`);
  runSQL(`DELETE FROM category;`, "DELETE category");
  uploadTable("category", ["id", "name"], catRows);

  // 3. dua_names + dua_name_category
  console.log("\n📂  duanames.csv → [dua_names] + [dua_name_category]");
  const namesRows = await parseCSV(path.join(__dirname, "duanames.csv"));
  console.log(`   ${namesRows.length} rows`);
  runSQL(`DELETE FROM dua_name_category;`, "DELETE dua_name_category");
  runSQL(`DELETE FROM dua_names;`, "DELETE dua_names");

  console.log("   Uploading dua_names...");
  uploadTable("dua_names",
    ["dua_global_id", "book_id", "chap_id", "dua_id", "chapname", "duaname", "tags", "ID"],
    namesRows
  );

  // Build junction rows from comma-separated category values
  const junctionRows = [];
  for (const row of namesRows) {
    const raw = String(row["category"] || "").trim();
    if (!raw || raw.toLowerCase() === "nan") continue;
    for (const catId of raw.split(",")) {
      const id = catId.trim();
      if (id) junctionRows.push({ dua_global_id: row["dua_global_id"], category_id: id });
    }
  }
  console.log(`   Uploading dua_name_category (${junctionRows.length} junction rows)...`);
  uploadTable("dua_name_category", ["dua_global_id", "category_id"], junctionRows);

  // 4. dua_details
  console.log("\n📂  duadetails.csv → [dua_details]");
  const detailsRows = await parseCSV(path.join(__dirname, "duadetails.csv"));
  console.log(`   ${detailsRows.length} rows`);
  runSQL(`DELETE FROM dua_details;`, "DELETE dua_details");
  uploadTable("dua_details", [
    "book_id", "dua_global_id", "ID", "dua_segment_id",
    "top", "arabic_diacless", "arabic",
    "transliteration", "translations", "bottom",
    "reference", "app_reference",
  ], detailsRows);

  // 5. dua_wbw
  console.log("\n📂  duawbw.csv → [dua_wbw]");
  const wbwRows = await parseCSV(path.join(__dirname, "duawbw.csv"));
  console.log(`   ${wbwRows.length} rows`);
  runSQL(`DELETE FROM dua_wbw;`, "DELETE dua_wbw");
  uploadTable("dua_wbw",
    ["dua_global_id", "dua_segment_id", "word_id", "arabic", "bn"],
    wbwRows
  );

  console.log("\n🎉  All done!");
  if (DRY_RUN) console.log("   (DRY RUN — nothing was written)\n");
}

main().catch((err) => {
  console.error("\n💥  Fatal:", err.message || err);
  process.exit(1);
});
