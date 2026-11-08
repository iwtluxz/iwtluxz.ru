import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const setup = await readFile(new URL('supabase/setup.sql', root), 'utf8');
const previous = await readFile(new URL('supabase/migrations/20261105_profile_editor_v2.sql', root), 'utf8');
const catalogContext = { window: {} };
vm.runInNewContext(await readFile(new URL('discord-badges.js', root), 'utf8'), catalogContext);
const catalog = catalogContext.window.IwtxzDiscordBadges;
const badgeIds = Array.from(catalog.items, item => item.id);
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const alice = id(1), bob = id(2), legacy = id(3);
const legacyBadges = ['nitro', 'house-bravery', 'server-booster', 'active-developer'];

test('Discord badge migration preserves existing profiles and validates and publishes the complete catalog', async t => {
  const migration = await readFile(new URL('supabase/migrations/20261108_discord_badge_catalog.sql', root), 'utf8');
  const db = new PGlite();
  async function as(role, userId, action) {
    await db.exec('reset role;');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId || '']);
    await db.exec(`set role ${role};`);
    try { return await action(); } finally { await db.exec('reset role;'); }
  }
  const save = async value => (await db.query('select public.builder_save_profile($1::jsonb) as value', [JSON.stringify(value)])).rows[0].value;
  const own = async () => (await db.query('select public.builder_get_profile() as value')).rows[0].value;
  const allProfiles = () => db.query('select a.username,a.user_id,a.created_at,d.settings as draft,d.updated_at,p.settings as published,p.published_at from public.profile_accounts a left join public.profile_drafts d using(user_id) left join public.profile_published p using(user_id) order by a.username');
  const base = {
    id: 'alice', owner: 'alice', title: 'Saved title', nickname: 'Saved nickname', description: 'Keep this description\nSecond line',
    nicknameAnimation: 'neon', descriptionAnimation: 'gradient', avatarDecoration: 'constellations', layoutVersion: 2,
    objectPositions: { name: { x: 0, y: 0 }, player: { x: 12.5, y: -4 } },
    profileScale: 82, nicknameSize: 28, descriptionSize: 19, discordShowCopyHint: false,
    discordUserId: '484816707798564894', discordSync: true, discordShowBadges: true, discordCardColor: '#221133', discordCardRadius: 24,
    backgroundEffect: 'snow', effectIntensity: 30, profileBadges: ['heart', 'music'], telegram: 'https://t.me/example'
  };
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
    await db.exec(setup);
    // Restore the prior normalizer to exercise a real existing installation.
    await db.exec(previous);
    for (const [userId, username] of [[alice, 'alice'], [bob, 'bob'], [legacy, 'iwtlu']]) {
      await db.query('insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3::jsonb,$4::jsonb)', [userId, `${username}@accounts.iwtxz.ru`, JSON.stringify({ username }), JSON.stringify({ profile_owner: username === 'iwtlu' })]);
    }
    await as('authenticated', alice, async () => { await save(base); await db.exec('select public.builder_publish_profile();'); });
    await as('authenticated', legacy, async () => { await save({ nickname: 'Legacy name', avatar: 'img/mainavatar.gif', showDiscord: true }); await db.exec('select public.builder_publish_profile();'); });
    const before = await allProfiles();

    await t.test('applying twice does not rewrite accounts, drafts, published settings or timestamps', async () => {
      await db.exec(migration); await db.exec(migration);
      assert.deepEqual((await allProfiles()).rows, before.rows);
      const capabilities = (await db.query('select public.builder_capabilities() as value')).rows[0].value;
      assert.equal(capabilities.discordBadges, true);
      assert.equal(capabilities.profileSettingsVersion, 7);
      for (const key of ['editorV2', 'freeLayout', 'profileLayout', 'interactiveEffects', 'profileEffects', 'customFonts']) assert.equal(capabilities[key], true, key);
    });

    await t.test('every catalog ID round-trips in valid batches through save, own read and publication', async () => {
      assert.equal(catalog.maximum, 32);
      assert.ok(badgeIds.length > 32);
      assert.equal(new Set(badgeIds).size, badgeIds.length);
      await as('authenticated', alice, async () => {
        for (let offset = 0; offset < badgeIds.length; offset += 32) {
          const selected = badgeIds.slice(offset, offset + 32);
          const result = await save({ ...base, discordBadges: selected });
          assert.deepEqual(result.discordBadges, selected);
          for (const [key, value] of Object.entries(base)) assert.deepEqual(result[key], value, key);
          assert.deepEqual((await own()).discordBadges, selected);
          await db.exec('select public.builder_publish_profile();');
          const publication = (await db.query('select settings from public.profile_published where username=$1', ['alice'])).rows[0].settings;
          assert.deepEqual(publication.discordBadges, selected);
          for (const [key, value] of Object.entries(base)) assert.deepEqual(publication[key], value, key);
        }
      });
    });

    await t.test('explicit empty selection remains empty while missing fields use only appropriate legacy defaults', async () => {
      await as('authenticated', alice, async () => assert.deepEqual((await save(base)).discordBadges, []));
      await as('authenticated', legacy, async () => {
        assert.deepEqual((await save({ nickname: 'Keep legacy' })).discordBadges, legacyBadges);
        assert.deepEqual((await save({ nickname: 'Keep legacy', discordBadges: [] })).discordBadges, []);
        await db.exec('select public.builder_publish_profile();');
        assert.deepEqual((await own()).discordBadges, []);
        const publication = (await db.query('select settings from public.profile_published where username=$1', ['iwtlu'])).rows[0].settings;
        assert.deepEqual(publication.discordBadges, []);
      });
      const saved = await allProfiles();
      await db.exec(migration);
      assert.deepEqual((await allProfiles()).rows, saved.rows);
    });

    await t.test('unknown IDs, nonstrings, nonarrays, null and overlong selections fail without altering the draft', async () => {
      await as('authenticated', alice, async () => {
        const previous = await own();
        for (const discordBadges of [null, {}, 'nitro', ['__proto__'], ['unknown-badge'], [123], [false], [null], [['nitro']], [{ id: 'nitro' }], Array(33).fill('nitro'), badgeIds.slice(0, 33)]) {
          await assert.rejects(save({ ...base, discordBadges }), error => error.code === '22023', JSON.stringify(discordBadges));
          assert.deepEqual(await own(), previous);
        }
      });
    });

    await t.test('repeated known IDs are deduplicated without changing the chosen display order', async () => {
      const input = [badgeIds[7], badgeIds[0], badgeIds[7], badgeIds[4], badgeIds[0]];
      await as('authenticated', alice, async () => {
        const result = await save({ ...base, discordBadges: input });
        assert.deepEqual(result.discordBadges, [badgeIds[7], badgeIds[0], badgeIds[4]]);
        assert.deepEqual(result.discordBadges, Array.from(catalog.normalize(input)));
      });
    });

    await t.test('badge settings retain existing owner isolation for drafts and writes', async () => {
      await as('authenticated', bob, async () => {
        assert.equal((await db.query('select settings from public.profile_drafts where user_id=$1', [alice])).rows.length, 0);
        await assert.rejects(save({ ...base, discordBadges: ['nitro'] }), error => error.code === '42501');
        assert.equal((await own()).owner, 'bob');
        assert.deepEqual((await save({ nickname: 'Bob', discordBadges: ['nitro'] })).discordBadges, ['nitro']);
      });
      await as('anon', null, async () => {
        await assert.rejects(save({ discordBadges: ['nitro'] }), error => error.code === '42501');
        await assert.rejects(db.query('select private.profile_normalize($1::jsonb,$2,$3::uuid)', [JSON.stringify(base), 'alice', alice]), error => error.code === '42501');
        const published = (await db.query('select settings from public.profile_published where username=$1', ['alice'])).rows[0].settings;
        assert.ok(Array.isArray(published.discordBadges));
      });
    });
  } finally { await db.close(); }
});
