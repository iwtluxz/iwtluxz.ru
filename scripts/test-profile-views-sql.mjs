import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const sql = async path => readFile(new URL(path, root), 'utf8');
const alice = '00000000-0000-4000-8000-000000000001';
const visitor = '10000000-0000-4000-8000-000000000001';
const second = '10000000-0000-4000-8000-000000000002';

test('appearance and view migration preserves profiles, validates settings and counts once per browser per UTC day', async () => {
  const db = new PGlite();
  const as = async (role, id, action) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
    await db.exec(`set role ${role}`);
    try { return await action(); } finally { await db.exec('reset role'); }
  };
  const save = async input => (await db.query('select public.builder_save_profile($1::jsonb) value', [JSON.stringify(input)])).rows[0].value;
  const count = async id => (await db.query('select public.profile_record_view($1,$2::uuid) value', ['alice', id])).rows[0].value;
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(value text) returns text[] language sql immutable as $$ select (string_to_array(value,'/'))[1:greatest(array_length(string_to_array(value,'/'),1)-1,0)] $$;
    `);
    await db.exec(await sql('supabase/setup.sql'));
    await db.exec(await sql('supabase/migrations/20261108_discord_badge_catalog.sql'));
    await db.exec(await sql('supabase/migrations/20261108_discord_badge_visibility.sql'));
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)', [alice, 'alice@accounts.iwtxz.ru', '{"username":"alice"}']);
    await as('authenticated', alice, async () => { await save({nickname:'Alice'}); await db.exec('select public.builder_publish_profile()'); });
    const before = (await db.query('select settings,published_at from public.profile_published')).rows;
    const migration = await sql('supabase/migrations/20261117_profile_views_and_appearance.sql');
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual((await db.query('select settings,published_at from public.profile_published')).rows, before);
    assert.equal((await db.query('select public.builder_capabilities() value')).rows[0].value.profileViewSettings, true);
    await as('anon', null, async () => { assert.equal(await count(visitor), null); });
    await as('authenticated', alice, async () => {
      const settings = {nickname:'Alice',descriptionColor:'#ABC123',showProfileViews:true,discordBadgeLimit:5};
      const saved = await save(settings);
      assert.equal(saved.descriptionColor, '#abc123');
      assert.equal(saved.showProfileViews, true);
      assert.equal(saved.discordBadgeLimit, 5);
      for (const invalid of [{descriptionColor:'red'}, {showProfileViews:'true'}, {discordBadgeLimit:0}, {discordBadgeLimit:7}]) {
        await assert.rejects(save({...settings,...invalid}), error => error.code === '22023');
      }
      await db.exec('select public.builder_publish_profile()');
      assert.equal(Number(await count(visitor)), 0);
    });
    await as('anon', null, async () => {
      assert.equal(Number(await count(visitor)), 1);
      assert.equal(Number(await count(visitor)), 1);
      assert.equal(Number(await count(second)), 2);
      await assert.rejects(db.query('select * from private.profile_daily_visitors'));
    });
    await db.exec("update private.profile_daily_visitors set visit_date = visit_date - 1");
    await as('anon', null, async () => { assert.equal(Number(await count(visitor)), 3); });
    await as('authenticated', alice, async () => { await save({nickname:'Alice',showProfileViews:false}); await db.exec('select public.builder_publish_profile()'); });
    await as('anon', null, async () => { assert.equal(await count(second), null); });
  } finally { await db.close(); }
});
