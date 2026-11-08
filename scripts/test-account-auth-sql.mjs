import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const setup = await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261108_account_email_and_oauth.sql', import.meta.url), 'utf8');
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const alice = id(1), bob = id(2), google = id(3), discord = id(4);

test('email and OAuth migration preserves data and enforces account ownership and private login boundaries', async t => {
  const db = new PGlite();
  const addUser = (userId, email, metadata = {}, app = { provider: 'email' }) => db.query(
    'insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3::jsonb,$4::jsonb)',
    [userId, email, JSON.stringify(metadata), JSON.stringify(app)]
  );
  const addIdentity = (userId, provider) => db.query(
    'insert into auth.identities(user_id,provider,provider_id,identity_data) values($1,$2,$3,$4::jsonb)',
    [userId, provider, `${provider}-${userId}`, JSON.stringify({ sub: userId })]
  );
  async function as(role, userId, action) {
    await db.exec('reset role;');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId || '']);
    await db.exec(`set role ${role};`);
    try { return await action(); } finally { await db.exec('reset role;'); }
  }
  const complete = username => db.query('select public.builder_complete_oauth_profile($1) as value', [username]);
  const expectCode = (promise, code) => assert.rejects(promise, error => error.code === code);
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
      create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, provider text not null, provider_id text not null, identity_data jsonb default '{}', unique(provider,provider_id));
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(value text) returns text[] language sql immutable as $$ select (string_to_array(value,'/'))[1:greatest(array_length(string_to_array(value,'/'),1)-1,0)] $$;
    `);
    await db.exec(setup);
    await addUser(alice, 'alice@accounts.iwtxz.ru', { username: 'alice' });
    await addUser(bob, 'bob@accounts.iwtxz.ru', { username: 'bob' });
    const savedSettings = { id: 'alice', owner: 'alice', nickname: 'Keep my page', description: 'Saved description', nicknameAnimation: 'neon', avatarDecoration: 'constellations', layoutVersion: 2, objectPositions: { name: { x: 0, y: 0 } } };
    await db.query('insert into public.profile_drafts(user_id,settings) values($1,$2::jsonb)', [alice, JSON.stringify(savedSettings)]);
    await db.query('insert into public.profile_published(username,user_id,settings) values($1,$2,$3::jsonb)', ['alice', alice, JSON.stringify(savedSettings)]);
    const before = await db.query('select a.username,a.user_id,d.settings as draft,p.settings as published,d.updated_at,p.published_at from public.profile_accounts a left join public.profile_drafts d using(user_id) left join public.profile_published p using(user_id) order by a.username');

    await t.test('applying twice leaves existing account addresses, draft contents and publications untouched', async () => {
      await db.exec(migration); await db.exec(migration);
      const after = await db.query('select a.username,a.user_id,d.settings as draft,p.settings as published,d.updated_at,p.published_at from public.profile_accounts a left join public.profile_drafts d using(user_id) left join public.profile_published p using(user_id) order by a.username');
      assert.deepEqual(after.rows, before.rows);
    });

    await t.test('legacy alias signups still create accounts and reject mismatched aliases or forged user metadata', async () => {
      await addUser(id(5), 'charlie@accounts.iwtxz.ru', { username: 'charlie' });
      assert.equal((await db.query('select username from public.profile_accounts where user_id=$1', [id(5)])).rows[0].username, 'charlie');
      await expectCode(addUser(id(6), 'different@example.test', { username: 'different' }), '22023');
      await expectCode(addUser(id(6), 'different@accounts.iwtxz.ru', { username: 'othername' }), '22023');
      await expectCode(addUser(id(6), 'iwtlu@accounts.iwtxz.ru', { username: 'iwtlu', profile_owner: true, provider: 'google' }), '42501');
      await expectCode(addUser(id(6), 'bad@accounts.iwtxz.ru', []), '22023');
    });

    await t.test('reserved owner claims retain one-time validation and are stripped from saved metadata', async () => {
      const claim = (await db.query("select private.issue_owner_claim('iwtlu') as value")).rows[0].value;
      assert.match(claim, /^[a-f0-9]{64}$/);
      await expectCode(addUser(id(6), 'iwtlu@accounts.iwtxz.ru', { username: 'iwtlu', owner_claim: 'a'.repeat(64) }), '42501');
      await addUser(id(6), 'iwtlu@accounts.iwtxz.ru', { username: 'iwtlu', owner_claim: claim });
      const row = (await db.query('select raw_user_meta_data from auth.users where id=$1', [id(6)])).rows[0];
      assert.deepEqual(row.raw_user_meta_data, { username: 'iwtlu' });
      assert.equal((await db.query("select used_by from private.profile_owner_claims where username='iwtlu'")).rows[0].used_by, id(6));
      await expectCode(addUser(id(7), 'iwtlu@accounts.iwtxz.ru', { username: 'iwtlu', owner_claim: claim }), '42501');
      const expired = (await db.query("select private.issue_owner_claim('eris') as value")).rows[0].value;
      await db.exec("update private.profile_owner_claims set expires_at=now()-interval '1 minute' where username='eris';");
      await expectCode(addUser(id(7), 'eris@accounts.iwtxz.ru', { username: 'eris', owner_claim: expired }), '42501');
    });

    await t.test('Google and Discord users do not claim page names before completing registration', async () => {
      await addUser(google, 'google-owner@example.test', { username: 'alice', owner_claim: 'a'.repeat(64) }, { provider: 'google' });
      await addUser(discord, 'discord-owner@example.test', { username: 'iwtlu' }, { provider: 'discord' });
      assert.equal((await db.query('select username from public.profile_accounts where user_id in ($1,$2)', [google, discord])).rows.length, 0);
      assert.equal((await db.query('select raw_user_meta_data from auth.users where id=$1', [google])).rows[0].raw_user_meta_data.owner_claim, undefined);
      await as('authenticated', google, () => expectCode(complete('new-google'), '42501'));
      await addIdentity(google, 'google'); await addIdentity(discord, 'discord');
    });

    await t.test('OAuth completion requires an authenticated caller with their own server-managed identity', async () => {
      await as('anon', null, () => expectCode(complete('anonymous'), '42501'));
      await as('authenticated', null, () => expectCode(complete('anonymous'), '42501'));
      const fake = id(8);
      await addUser(fake, 'fake@example.test', { provider: 'google', identities: [{ provider: 'google' }] }, { provider: 'google' });
      await as('authenticated', fake, () => expectCode(complete('forged-profile'), '42501'));
      await addIdentity(fake, 'email');
      await as('authenticated', fake, () => expectCode(complete('forged-profile'), '42501'));
      await as('authenticated', id(99), () => expectCode(complete('missing-user'), '42501'));
      await as('authenticated', google, async () => {
        await expectCode(db.query('select * from auth.identities'), '42501');
        const result = await complete(' My-Google ');
        assert.deepEqual(result.rows[0].value, { username: 'my-google' });
      });
      assert.equal((await db.query("select user_id from public.profile_accounts where username='my-google'")).rows[0].user_id, google);
    });

    await t.test('OAuth cannot steal occupied or reserved names, invalid names fail and repeated completion cannot rename an account', async () => {
      await as('authenticated', discord, async () => {
        for (const name of ['admin', 'iwtlu', 'strelok']) await expectCode(complete(name), '42501');
        await expectCode(complete('alice'), '23505');
        for (const name of ['', 'ab', '_invalid', 'x'.repeat(33), 'русский']) await expectCode(complete(name), '22023');
        assert.deepEqual((await complete('discord-page')).rows[0].value, { username: 'discord-page' });
        assert.deepEqual((await complete('alice')).rows[0].value, { username: 'discord-page' });
      });
      await as('authenticated', alice, async () => {
        assert.deepEqual((await complete('some-other-name')).rows[0].value, { username: 'alice' });
        assert.equal((await db.query('select username from public.profile_accounts where user_id=$1', [google])).rows.length, 0);
      });
      assert.equal((await db.query("select user_id from public.profile_accounts where username='alice'")).rows[0].user_id, alice);
    });

    await t.test('confirmed email changes retain username and all profile data; empty and service alias changes are rejected', async () => {
      await db.query('update auth.users set email=$1,email_confirmed_at=now() where id=$2', ['recovery-mail@example.test', alice]);
      assert.equal((await db.query('select username from public.profile_accounts where user_id=$1', [alice])).rows[0].username, 'alice');
      assert.deepEqual((await db.query('select settings from public.profile_drafts where user_id=$1', [alice])).rows[0].settings, savedSettings);
      assert.deepEqual((await db.query('select settings from public.profile_published where user_id=$1', [alice])).rows[0].settings, savedSettings);
      for (const email of ['', null, 'other@accounts.iwtxz.ru']) await expectCode(db.query('update auth.users set email=$1 where id=$2', [email, alice]), '22023');
    });

    await t.test('private email lookup is forbidden to visitors and signed-in users and only service_role can resolve it', async () => {
      for (const role of ['anon', 'authenticated']) {
        await as(role, alice, async () => {
          await expectCode(db.query("select public.builder_private_login_email('alice')"), '42501');
          await expectCode(db.query('select public.builder_private_login_attempt($1::text[])', [['a'.repeat(64)]]), '42501');
          await expectCode(db.query('select * from private.profile_login_attempts'), '42501');
        });
      }
      await as('service_role', null, async () => {
        assert.equal((await db.query("select public.builder_private_login_email(' ALICE ') as value")).rows[0].value, 'recovery-mail@example.test');
        assert.equal((await db.query("select public.builder_private_login_email('missing-account') as value")).rows[0].value, null);
      });
    });

    await t.test('rate limiter enforces both keys, validates input, resets expired windows and cleans old hashes', async () => {
      const first = 'a'.repeat(64), second = 'b'.repeat(64);
      const attempt = keys => db.query('select public.builder_private_login_attempt($1::text[]) as allowed', [keys]);
      await as('service_role', null, async () => {
        for (let count = 1; count <= 12; count++) assert.equal((await attempt([first, second])).rows[0].allowed, true);
        assert.equal((await attempt([second, first])).rows[0].allowed, false);
        for (const keys of [[], null, ['bad'], [null], [first, second, 'c'.repeat(64)]]) assert.equal((await attempt(keys)).rows[0].allowed, false, JSON.stringify(keys));
      });
      assert.deepEqual((await db.query('select attempts from private.profile_login_attempts order by key_hash')).rows.map(row => row.attempts), [13, 13]);
      await db.exec("update private.profile_login_attempts set window_start=now()-interval '6 minutes';");
      await as('service_role', null, async () => assert.equal((await attempt([first, second])).rows[0].allowed, true));
      assert.deepEqual((await db.query('select attempts from private.profile_login_attempts order by key_hash')).rows.map(row => row.attempts), [1, 1]);
      await db.query("insert into private.profile_login_attempts(key_hash,window_start) values($1,now()-interval '2 days')", ['c'.repeat(64)]);
      await as('service_role', null, () => attempt([first]));
      assert.equal((await db.query('select count(*)::integer as total from private.profile_login_attempts')).rows[0].total, 2);
    });
  } finally { await db.close(); }
});
