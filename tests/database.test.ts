import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("webhook deduplication occurs in the same SQL transaction as ingestion",()=>{const sql=readFileSync("supabase/migrations/001_workspace.sql","utf8");assert.match(sql,/event_key text primary key/);assert.match(sql,/on conflict do nothing;if not found then return false/);assert.match(sql,/wa_id text unique/);assert.match(sql,/idempotency_key text unique/);assert.match(sql,/for update skip locked/)});
test("queue RPCs are not executable by browser roles",()=>{const sql=readFileSync("supabase/migrations/001_workspace.sql","utf8");assert.match(sql,/revoke all on function public.claim_jobs\(\) from public,anon,authenticated/);assert.match(sql,/revoke all on function public.ingest_whatsapp\(text,jsonb\) from public,anon,authenticated/)});
