import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const setup = await readFile(new URL("../supabase/setup.sql", import.meta.url), "utf8");
const previous = await readFile(new URL("../supabase/migrations/20261030_profile_customization.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261030_profile_effects_and_socials.sql", import.meta.url), "utf8");
const alice = "967385a2-8f95-4499-97b1-8ff92d973cfe";
const bob = "967385a2-8f95-4499-97b1-8ff92d973caa";

test("profile effects migration preserves old data, round-trips features, validates input and retains owner isolation", async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(value text) returns text[] language sql immutable as $$ select (string_to_array(value,'/'))[1:greatest(array_length(string_to_array(value,'/'),1)-1,0)] $$;
    `);
    await db.exec(setup);
    await db.exec(previous);
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,'alice@accounts.iwtxz.ru','{\"username\":\"alice\"}'),($2,'bob@accounts.iwtxz.ru','{\"username\":\"bob\"}')", [alice, bob]);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${alice}',false);`);
    await db.query("select public.builder_save_profile($1::jsonb)", [JSON.stringify({ nickname: "Keep this nickname", description: "Existing text" })]);
    await db.exec("select public.builder_publish_profile(); reset role;");
    const before = await db.query("select settings from public.profile_drafts where user_id=$1", [alice]);

    await t.test("applying twice leaves existing drafts and publications untouched", async () => {
      await db.exec(migration); await db.exec(migration);
      const after = await db.query("select settings from public.profile_drafts where user_id=$1", [alice]);
      assert.deepEqual(after.rows, before.rows);
      const capabilities = await db.query("select public.builder_capabilities() as value");
      assert.equal(capabilities.rows[0].value.profileEffects, true);
      assert.equal(capabilities.rows[0].value.profileSettingsVersion, 3);
    });

    const settings = { id: "alice", owner: "alice", nickname: "Animated Alice", nicknameAnimation: "shimmer", avatarDecoration: "sakura", youtube: "https://youtube.com/@alice", github: "https://github.com/alice", vk: "https://vk.com/alice", website: "https://example.com", profileBadges: ["moon"] };
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${alice}',false);`);
    await t.test("new fields survive both draft save and publication", async () => {
      const result = await db.query("select public.builder_save_profile($1::jsonb) as value", [JSON.stringify(settings)]);
      for (const key of ["nicknameAnimation", "avatarDecoration", "youtube", "github", "vk", "website"]) assert.equal(result.rows[0].value[key], settings[key]);
      await db.exec("select public.builder_publish_profile();");
      const published = await db.query("select settings from public.profile_published where username='alice'");
      assert.equal(published.rows[0].settings.nicknameAnimation, "shimmer");
      assert.equal(published.rows[0].settings.avatarDecoration, "sakura");
    });
    await t.test("unknown animations, arbitrary decoration URLs and executable social links are rejected", async () => {
      for (const update of [{ nicknameAnimation: "injected-animation" }, { avatarDecoration: "https://evil.example/image" }, { youtube: "javascript:alert(1)" }, { github: "http://example.com" }]) {
        await assert.rejects(db.query("select public.builder_save_profile($1::jsonb)", [JSON.stringify({ ...settings, ...update })]), error => error.code === "22023");
      }
    });
    await t.test("another account cannot read the draft or save as its owner", async () => {
      await db.exec(`select set_config('request.jwt.claim.sub','${bob}',false);`);
      const draft = await db.query("select * from public.profile_drafts where user_id=$1", [alice]);
      assert.equal(draft.rows.length, 0);
      await assert.rejects(db.query("select public.builder_save_profile($1::jsonb)", [JSON.stringify(settings)]), error => error.code === "42501");
    });
  } finally { await db.close(); }
});
