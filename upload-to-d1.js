#!/usr/bin/env node

/**
 * upload-to-d1.js
 * Upload Dua CSV files into Cloudflare D1 via Wrangler.
 *
 * Schema:
 *   category          → id, name
 *   dua_names         → dua_global_id, book_id, chap_id, dua_id, chapname, duaname, tags, ID
 *   dua_name_category → dua_global_id, category_id   (many-to-many junction)
 *   dua_details       → book_id, dua_global_id, ID, dua_segment_id, top, arabic_diacless,
 *                       arabic, transliteration, translations, bottom, reference, app_reference
 *   dua_wbw           → dua_global_id, dua_segment_id, word_id, arabic, bn
 *
 * Usage:
 *   node upload-to-d1.js --db <DATABASE_NAME> [--batch 50] [--dry-run]
 *
 * Requirements:
 *   npm install csv-parse
 *   npx wrangler login
 */

import { execSync }                                               from "child_process";
import { createReadStream, existsSync, writeFileSync, unlinkSync } from "fs";
import { parse }                                                  from "csv-parse";
import path                                                       from "path";
import { fileURLToPath }                                          from "url";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const args       = process.argv.slice(2);
const getArg     = (f, d) => { const i = args.indexOf(f); return i !== -1 && args[i+1] ? args[i+1] : d; };
const DB_NAME    = getArg("--db", null);
const BATCH_SIZE = parseInt(getArg("--batch", "50"), 10);
const DRY_RUN    = args.includes("--dry-run");

if (!DB_NAME) {
  console.error("❌  Usage: node upload-to-d1.js --db <DATABASE_NAME> [--batch 50] [--dry-run]");
  process.exit(1);
}

// ─── SQL: create all tables ───────────────────────────────────────────────────
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

PRAGMA foreign_keys = ON;
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

function buildInsert(table, columns, rows) {
  const cols = columns.join(", ");
  const vals = rows.map(r => `(${columns.map(c => esc(r[c])).join(", ")})`).join(",\n");
  return `INSERT OR REPLACE INTO ${table} (${cols}) VALUES\n${vals};`;
}

function runSQL(sql, label) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] ${label}: ${sql.slice(0, 100).replace(/\n/g, " ")}...`);
    return;
  }
  const tmp = `/tmp/d1_${Date.now()}_${Math.random().toString(36).slice(2)}.sql`;
  writeFileSync(tmp, sql, "utf8");
  try {
    execSync(`npx wrangler d1 execute "${DB_NAME}" --file="${tmp}" --remote`,
      { stdio: "pipe", encoding: "utf8" });
  } catch (err) {
    console.error(`\n❌  Wrangler error [${label}]:`);
    console.error(err.stderr || err.message);
    throw err;
  } finally {
    try { unlinkSync(tmp); } catch (_) {}
  }
}

function uploadInBatches(table, columns, rows, label) {
  const total = rows.length;
  const t0 = Date.now();
  let inserted = 0;
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    runSQL(buildInsert(table, columns, chunk), `${label} batch ${i}`);
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
  console.log(`   Batch    : ${BATCH_SIZE} rows`);
  console.log(`   Mode     : ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  // ── 1. Create tables ────────────────────────────────────────────────────────
  console.log("📦  Creating tables...");
  runSQL(CREATE_SQL, "CREATE all tables");
  console.log("   ✔  All tables ready\n");

  // ── 2. category ─────────────────────────────────────────────────────────────
  const catFile = path.join(__dirname, "category.csv");
  console.log(`📂  category.csv → [category]`);
  const catRows = await parseCSV(catFile);
  console.log(`   ${catRows.length} rows`);
  runSQL(`DELETE FROM category;`, "DELETE category");
  uploadInBatches("category", ["id", "name"], catRows, "category");

  // ── 3. dua_names + dua_name_category ────────────────────────────────────────
  const namesFile = path.join(__dirname, "duanames.csv");
  console.log(`\n📂  duanames.csv → [dua_names] + [dua_name_category]`);
  const namesRows = await parseCSV(namesFile);
  console.log(`   ${namesRows.length} rows`);

  // Strip 'category' column → goes to junction table instead
  const namesCols = ["dua_global_id", "book_id", "chap_id", "dua_id", "chapname", "duaname", "tags", "ID"];
  runSQL(`DELETE FROM dua_name_category;`, "DELETE dua_name_category");
  runSQL(`DELETE FROM dua_names;`, "DELETE dua_names");
  console.log("   Uploading dua_names...");
  uploadInBatches("dua_names", namesCols, namesRows, "dua_names");

  // Build junction rows — split comma-separated category values
  const junctionRows = [];
  for (const row of namesRows) {
    const rawCat = String(row["category"] || "").trim();
    if (!rawCat || rawCat.toLowerCase() === "nan") continue;
    for (const catId of rawCat.split(",")) {
      const id = catId.trim();
      if (id) junctionRows.push({ dua_global_id: row["dua_global_id"], category_id: id });
    }
  }
  console.log(`   Uploading dua_name_category (${junctionRows.length} junction rows)...`);
  uploadInBatches("dua_name_category", ["dua_global_id", "category_id"], junctionRows, "dua_name_category");

  // ── 4. dua_details ──────────────────────────────────────────────────────────
  const detailsFile = path.join(__dirname, "duadetails.csv");
  console.log(`\n📂  duadetails.csv → [dua_details]`);
  const detailsRows = await parseCSV(detailsFile);
  console.log(`   ${detailsRows.length} rows`);
  runSQL(`DELETE FROM dua_details;`, "DELETE dua_details");
  uploadInBatches("dua_details", [
    "book_id", "dua_global_id", "ID", "dua_segment_id",
    "top", "arabic_diacless", "arabic",
    "transliteration", "translations", "bottom",
    "reference", "app_reference",
  ], detailsRows, "dua_details");

  // ── 5. dua_wbw ──────────────────────────────────────────────────────────────
  const wbwFile = path.join(__dirname, "duawbw.csv");
  console.log(`\n📂  duawbw.csv → [dua_wbw]`);
  const wbwRows = await parseCSV(wbwFile);
  console.log(`   ${wbwRows.length} rows`);
  runSQL(`DELETE FROM dua_wbw;`, "DELETE dua_wbw");
  uploadInBatches("dua_wbw", [
    "dua_global_id", "dua_segment_id", "word_id", "arabic", "bn",
  ], wbwRows, "dua_wbw");

  console.log("\n🎉  All done!");
  if (DRY_RUN) console.log("   (DRY RUN — nothing was written)\n");
}

main().catch((err) => {
  console.error("\n💥  Fatal:", err.message || err);
  process.exit(1);
});
