import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const file = path => readFile(new URL(path, root), 'utf8');
const setup = await file('supabase/setup.sql');
const catalogMigration = await file('supabase/migrations/20261108_discord_badge_catalog.sql');
const visibilityMigration = await file('supabase/migrations/20261108_discord_badge_visibility.sql');
const oldViewsMigration = await file('supabase/migrations/20261117_profile_views_and_appearance.sql');
const migration = await file('supabase/migrations/20261117_profile_catalog_and_layout.sql');
const beforeCounter = setup.indexOf('-- Optional per-profile view counter.');
assert.ok(beforeCounter > 0, 'the fixture must remove the new optional counter before modeling an old installation');
const oldSetup = setup.slice(0, beforeCounter);
const oldDecorationList = visibilityMigration.match(/value := private\.profile_text\(input, 'avatarDecoration',[^\n]*\);\s*if value not in \(([^\n]+)\)/)?.[1];
assert.ok(oldDecorationList);
const legacyIds = Array.from(oldDecorationList.matchAll(/'([^']+)'/g), match => match[1]);
const context = {window:{}};
vm.runInNewContext(await file('profile-decorations.js'), context);
const currentIds = Array.from(context.window.IwtxzAvatarDecorations.items, item => item.id);
const alice = '00000000-0000-4000-8000-000000000001';
const bob = '00000000-0000-4000-8000-000000000002';
const visitor = '10000000-0000-4000-8000-000000000001';
const visitor2 = '10000000-0000-4000-8000-000000000002';
const base = {
  id:'alice',owner:'alice',nickname:'Existing nickname',title:'Saved title',description:'Existing description\nSecond line',
  avatarDecoration:'sakura',descriptionAnimation:'float',nicknameAnimation:'neon',layoutVersion:2,
  objectPositions:{name:{x:0,y:0},player:{x:4.25,y:-2.5}},backgroundEffect:'snow',effectIntensity:35,
  profileScale:84,descriptionSize:18,nicknameSize:30,profileBadges:['heart'],
  discordBadges:['nitro-opal','streaming-newcomer','orbs'],discordHiddenBadges:['house-bravery'],
  discordUserId:'484816707798564894',discordSync:true,discordBadgeLimit:4,discordShowCopyHint:false,
  descriptionColor:'#aabbcc',showProfileViews:true
};

async function fixture({withOldViews = false} = {}) {
  const db = new PGlite();
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
  await db.exec(oldSetup);
  // The upgrade starts from the deployed badge contract, not the new setup's definitions.
  await db.exec(catalogMigration);
  await db.exec(visibilityMigration);
  if (withOldViews) await db.exec(oldViewsMigration);
  for (const [userId, username] of [[alice,'alice'],[bob,'bob']]) await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)', [userId, `${username}@accounts.iwtxz.ru`, JSON.stringify({username})]);
  const as = async (role, userId, action) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId || '']);
    await db.exec(`set role ${role}`);
    try { return await action(); } finally { await db.exec('reset role'); }
  };
  const save = async settings => (await db.query('select public.builder_save_profile($1::jsonb) value',[JSON.stringify(settings)])).rows[0].value;
  const own = async () => (await db.query('select public.builder_get_profile() value')).rows[0].value;
  const profiles = async () => (await db.query('select a.username,a.user_id,a.created_at,d.settings draft,d.updated_at,p.settings published,p.published_at from public.profile_accounts a left join public.profile_drafts d using(user_id) left join public.profile_published p using(user_id) order by a.username')).rows;
  const count = async id => (await db.query('select public.profile_record_view($1,$2::uuid) value',['alice',id])).rows[0].value;
  return {db,as,save,own,profiles,count};
}

test('catalog/layout migration installs the optional counter directly after badge visibility without rewriting profiles', async () => {
  const {db,as,save,profiles,count} = await fixture();
  try {
    assert.equal((await db.query("select to_regprocedure('public.profile_record_view(text,uuid)') value")).rows[0].value, null);
    await as('authenticated',alice,async () => { await save(base); await db.exec('select public.builder_publish_profile()'); });
    const before = await profiles();
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual(await profiles(),before);
    const capabilities = (await db.query('select public.builder_capabilities() value')).rows[0].value;
    for (const flag of ['profileCatalogLayout','profileViewSettings','discordBadges','discordBadgeVisibility','freeLayout','editorV2','profileEffects']) assert.equal(capabilities[flag],true,flag);
    assert.equal(capabilities.profileSettingsVersion,7);
    await as('authenticated',alice,async () => { await save(base); await db.exec('select public.builder_publish_profile()'); });
    await as('anon',null,async () => { assert.equal(Number(await count(visitor)),1); assert.equal(Number(await count(visitor)),1); });
  } finally { await db.close(); }
});

test('catalog/layout upgrade preserves counters, validates editable settings and retains ownership boundaries', async t => {
  const {db,as,save,own,profiles,count} = await fixture({withOldViews:true});
  const counterRows = async () => ({totals:(await db.query('select * from private.profile_view_totals order by user_id')).rows,visitors:(await db.query('select * from private.profile_daily_visitors order by user_id,visit_date,visitor_id')).rows});
  try {
    await as('authenticated',alice,async () => { await save(base); await db.exec('select public.builder_publish_profile()'); });
    await as('anon',null,async () => { assert.equal(Number(await count(visitor)),1); });
    const before = await profiles(), countsBefore = await counterRows();
    await t.test('applying twice preserves drafts, publication timestamps, badges and existing view totals',async () => {
      await db.exec(migration); await db.exec(migration);
      assert.deepEqual(await profiles(),before);
      assert.deepEqual(await counterRows(),countsBefore);
      await as('anon',null,async () => { assert.equal(Number(await count(visitor)),1); assert.equal(Number(await count(visitor2)),2); });
    });

    await t.test('missing fields default to a static disabled gradient and text counter without a custom view position',async () => {
      await as('authenticated',bob,async () => {
        const saved = await save({nickname:'Bob'});
        for (const [key,value] of Object.entries({descriptionGradient:false,descriptionGradientAnimated:false,descriptionGradientStart:'#ffffff',descriptionGradientEnd:'#8b5cf6',descriptionGradientAngle:90,descriptionGradientSpeed:6,profileViewsStyle:'text',profileViewsSize:12,profileViewsColor:'#b6b4bd',showProfileViews:false})) assert.deepEqual(saved[key],value,key);
        assert.deepEqual(saved.objectPositions,{});
      });
    });

    const edited = {...base,descriptionGradient:true,descriptionGradientAnimated:true,descriptionGradientStart:'#FF2299',descriptionGradientEnd:'#4488FF',descriptionGradientAngle:135,descriptionGradientSpeed:12,profileViewsStyle:'eye',profileViewsSize:19,profileViewsColor:'#AABBCC',objectPositions:{...base.objectPositions,views:{x:0,y:0}}};
    await t.test('custom gradients and eye counter with zero coordinates survive save, own read and publication',async () => {
      await as('authenticated',alice,async () => {
        const saved = await save(edited);
        for (const [key,value] of Object.entries(edited)) assert.deepEqual(saved[key],['descriptionGradientStart','descriptionGradientEnd','profileViewsColor'].includes(key)?value.toLowerCase():value,key);
        const reloaded = await own();
        for (const key of Object.keys(edited)) assert.deepEqual(reloaded[key],saved[key],key);
        await db.exec('select public.builder_publish_profile()');
        const published = (await db.query('select settings from public.profile_published where username=$1',['alice'])).rows[0].settings;
        for (const key of Object.keys(edited)) assert.deepEqual(published[key],saved[key],key);
        assert.deepEqual(published.objectPositions.views,{x:0,y:0});
      });
      await as('anon',null,async () => assert.equal(Number(await count(visitor)),2));
    });

    await t.test('all checked-in decoration IDs and every prior choice are accepted without rewriting IDs',async () => {
      assert.ok(legacyIds.length>=39,'all 37 prior designs plus none/Discord must stay supported');
      const ids = [...new Set([...legacyIds,...currentIds,'discord-a_0123456789abcdef0123456789abcdef'])];
      const normalized = (await db.query("select choice, private.profile_normalize(jsonb_build_object('avatarDecoration',choice),'alice',$1::uuid)->>'avatarDecoration' saved from unnest($2::text[]) choice",[alice,ids])).rows;
      assert.equal(normalized.length,ids.length);
      for (const row of normalized) assert.equal(row.saved,row.choice,row.choice);
      await as('authenticated',alice,async () => {
        const choice = currentIds.find(id=>id.startsWith('discord-a_')) || 'discord-a_0123456789abcdef0123456789abcdef';
        assert.equal((await save({...edited,avatarDecoration:choice})).avatarDecoration,choice);
        await db.exec('select public.builder_publish_profile()');
        assert.equal((await own()).avatarDecoration,choice);
        assert.equal((await db.query('select settings from public.profile_published where username=$1',['alice'])).rows[0].settings.avatarDecoration,choice);
      });
    });

    await t.test('invalid colors, gradient controls, counter appearance and block coordinates reject atomically',async () => {
      const invalid = [
        ...['descriptionGradientStart','descriptionGradientEnd','profileViewsColor'].flatMap(key=>['red','#fff','#12345678','#ffffff;background:red',null,25].map(value=>({[key]:value}))),
        ...['descriptionGradient','descriptionGradientAnimated'].flatMap(key=>['true',1,null,{}].map(value=>({[key]:value}))),
        ...[-1,361,'90',null].map(descriptionGradientAngle=>({descriptionGradientAngle})),
        ...[1,31,'6',null].map(descriptionGradientSpeed=>({descriptionGradientSpeed})),
        ...[9,25,'12',null].map(profileViewsSize=>({profileViewsSize})),
        ...['icon','eye;display:none',null,12].map(profileViewsStyle=>({profileViewsStyle})),
        ...['https://cdn.discordapp.com/avatar-decoration-presets/a_0123456789abcdef0123456789abcdef.png','discord-a_short','discord-a_'+'g'.repeat(32),'discord-a_'+'a'.repeat(33),'discord-a_'+'A'.repeat(32),'discord-'+ 'a'.repeat(32),'__proto__'].map(avatarDecoration=>({avatarDecoration})),
        {objectPositions:{unknown:{x:0,y:0}}},{objectPositions:{views:{x:41,y:0}}},{objectPositions:{views:{x:0,y:-41}}},{objectPositions:{views:{x:'0',y:0}}},{objectPositions:{views:{x:0}}},{objectPositions:{views:{x:0,y:0,width:10}}},{objectPositions:{views:null}}
      ];
      await as('authenticated',alice,async () => {
        const prior = await own();
        for (const patch of invalid) {
          await assert.rejects(save({...edited,...patch}),error=>error.code==='22023',JSON.stringify(patch));
          assert.deepEqual(await own(),prior,'invalid input must not partially overwrite a draft');
        }
        for (const patch of [{descriptionGradientAngle:0,descriptionGradientSpeed:2,profileViewsSize:10},{descriptionGradientAngle:360,descriptionGradientSpeed:30,profileViewsSize:24}]) {
          const result=await save({...edited,...patch});for(const [key,value] of Object.entries(patch))assert.equal(result[key],value,key);
        }
      });
    });

    await t.test('counter and normalizer stay private; another user cannot read or save owner drafts',async () => {
      await as('authenticated',bob,async () => {
        assert.equal((await db.query('select settings from public.profile_drafts where user_id=$1',[alice])).rows.length,0);
        await assert.rejects(save(edited),error=>error.code==='42501');
        await assert.rejects(db.query('select * from private.profile_view_totals'),error=>error.code==='42501');
        await assert.rejects(db.query('select * from private.profile_daily_visitors'),error=>error.code==='42501');
      });
      await as('anon',null,async () => {
        await assert.rejects(save(edited),error=>error.code==='42501');
        await assert.rejects(db.query('select private.profile_normalize($1::jsonb,$2,$3::uuid)',[JSON.stringify(edited),'alice',alice]),error=>error.code==='42501');
        await assert.rejects(db.query('select private.profile_default($1)',['alice']),error=>error.code==='42501');
        await assert.rejects(db.query('select * from private.profile_view_totals'),error=>error.code==='42501');
        await assert.rejects(db.query('select * from private.profile_daily_visitors'),error=>error.code==='42501');
        const published=(await db.query('select settings from public.profile_published where username=$1',['alice'])).rows[0].settings;
        assert.deepEqual(published.discordBadges,base.discordBadges);
        assert.deepEqual(published.discordHiddenBadges,base.discordHiddenBadges);
        assert.equal((await db.query('select public.builder_capabilities() value')).rows[0].value.profileCatalogLayout,true);
      });
      const after = await profiles(), countersAfter = await counterRows();
      await db.exec(migration);
      assert.deepEqual(await profiles(),after);
      assert.deepEqual(await counterRows(),countersAfter);
    });
  } finally { await db.close(); }
});
