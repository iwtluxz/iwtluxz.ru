import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const root=new URL('../',import.meta.url);
const setup=await readFile(new URL('supabase/setup.sql',root),'utf8');
const previous=await readFile(new URL('supabase/migrations/20261108_discord_badge_catalog.sql',root),'utf8');
const migration=await readFile(new URL('supabase/migrations/20261108_discord_badge_visibility.sql',root),'utf8');
const context={window:{}};
vm.runInNewContext(await readFile(new URL('discord-badges.js',root),'utf8'),context);
const catalog=context.window.IwtxzDiscordBadges;
const badgeIds=Array.from(catalog.items,item=>item.id);
const alice='00000000-0000-4000-8000-000000000001';
const bob='00000000-0000-4000-8000-000000000002';
const legacy='00000000-0000-4000-8000-000000000003';

test('earned Discord badge visibility migration preserves existing data and persists only validated hidden IDs',async t=>{
  const db=new PGlite();
  const save=async value=>(await db.query('select public.builder_save_profile($1::jsonb) as value',[JSON.stringify(value)])).rows[0].value;
  const own=async()=>(await db.query('select public.builder_get_profile() as value')).rows[0].value;
  const allProfiles=()=>db.query('select a.username,a.user_id,a.created_at,d.settings as draft,d.updated_at,p.settings as published,p.published_at from public.profile_accounts a left join public.profile_drafts d using(user_id) left join public.profile_published p using(user_id) order by a.username');
  async function as(role,userId,action){
    await db.exec('reset role;');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[userId||'']);
    await db.exec(`set role ${role};`);
    try{return await action();}finally{await db.exec('reset role;');}
  }
  const base={
    id:'alice',owner:'alice',title:'Existing title',nickname:'Saved name',description:'Keep existing description',
    nicknameAnimation:'neon',descriptionAnimation:'gradient',avatarDecoration:'constellations',layoutVersion:2,
    objectPositions:{name:{x:0,y:0},player:{x:9.25,y:-2}},profileScale:84,nicknameSize:27,
    backgroundEffect:'snow',effectIntensity:35,discordSync:true,discordShowBadges:true,
    discordUserId:'484816707798564894',discordCardRadius:24,discordShowCopyHint:false,
    discordBadges:['nitro-current','house-bravery'],profileBadges:['heart']
  };
  try{
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
    // Reinstall the currently deployed catalog normalizer to model the upgrade.
    await db.exec(previous);
    for(const [userId,username]of[[alice,'alice'],[bob,'bob'],[legacy,'iwtlu']])await db.query('insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3::jsonb,$4::jsonb)',[userId,`${username}@accounts.iwtxz.ru`,JSON.stringify({username}),JSON.stringify({profile_owner:username==='iwtlu'})]);
    await as('authenticated',alice,async()=>{await save(base);await db.exec('select public.builder_publish_profile();');});
    await as('authenticated',legacy,async()=>{await save({nickname:'Legacy profile',discordBadges:['nitro','active-developer']});await db.exec('select public.builder_publish_profile();');});
    const before=await allProfiles();
    assert.equal(Object.hasOwn(before.rows.find(row=>row.username==='alice').draft,'discordHiddenBadges'),false);

    await t.test('reapplying the migration preserves all rows, timestamps and prior manual selections',async()=>{
      await db.exec(migration);await db.exec(migration);
      assert.deepEqual((await allProfiles()).rows,before.rows);
      const caps=(await db.query('select public.builder_capabilities() as value')).rows[0].value;
      assert.equal(caps.discordBadgeVisibility,true);
      assert.equal(caps.discordBadges,true);
      assert.equal(caps.profileSettingsVersion,7);
      for(const flag of['editorV2','freeLayout','profileLayout','interactiveEffects','profileEffects','customFonts'])assert.equal(caps[flag],true,flag);
    });

    await t.test('hidden IDs round-trip through own read and publication while all other settings stay intact',async()=>{
      await as('authenticated',alice,async()=>{
        const hidden=['house-bravery','server-booster','active-developer'];
        const result=await save({...base,discordHiddenBadges:hidden});
        assert.deepEqual(result.discordHiddenBadges,hidden);
        for(const [key,value]of Object.entries(base))assert.deepEqual(result[key],value,key);
        assert.deepEqual((await own()).discordHiddenBadges,hidden);
        await db.exec('select public.builder_publish_profile();');
        const published=(await db.query('select settings from public.profile_published where username=$1',['alice'])).rows[0].settings;
        assert.deepEqual(published.discordHiddenBadges,hidden);
        for(const [key,value]of Object.entries(base))assert.deepEqual(published[key],value,key);
      });
    });

    await t.test('missing and explicit empty hidden lists mean all earned badges remain visible without inheriting manual choices',async()=>{
      for(const [userId,username]of[[alice,'alice'],[legacy,'iwtlu']])await as('authenticated',userId,async()=>{
        const defaults=await save({nickname:username});
        assert.deepEqual(defaults.discordHiddenBadges,[]);
        const cleared=await save({nickname:username,discordHiddenBadges:[]});
        assert.deepEqual(cleared.discordHiddenBadges,[]);
        await db.exec('select public.builder_publish_profile();');
      });
      const after=await allProfiles();
      await db.exec(migration);
      assert.deepEqual((await allProfiles()).rows,after.rows);
    });

    await t.test('unknown IDs, nonstrings, nonarrays, null and excessive lists fail without changing any draft',async()=>{
      await as('authenticated',alice,async()=>{
        const prior=await own();
        for(const discordHiddenBadges of[null,{},'house-bravery',['unknown-badge'],['__proto__'],['constructor'],[null],[false],[123],[['house-bravery']],[{id:'house-bravery'}],Array(33).fill('house-bravery'),badgeIds.slice(0,33)]){
          await assert.rejects(save({...base,discordHiddenBadges}),error=>error.code==='22023',JSON.stringify(discordHiddenBadges));
          assert.deepEqual(await own(),prior);
        }
      });
    });

    await t.test('known hidden IDs keep stable order, remove duplicates and respect the 32-entry boundary',async()=>{
      await as('authenticated',alice,async()=>{
        const input=['house-bravery','active-developer','house-bravery','server-booster','active-developer'];
        assert.deepEqual((await save({...base,discordHiddenBadges:input})).discordHiddenBadges,['house-bravery','active-developer','server-booster']);
        assert.deepEqual((await save({...base,discordHiddenBadges:badgeIds.slice(0,32)})).discordHiddenBadges,badgeIds.slice(0,32));
      });
    });

    await t.test('other accounts cannot read or change owner visibility and visitors can read only published settings',async()=>{
      await as('authenticated',bob,async()=>{
        assert.equal((await db.query('select settings from public.profile_drafts where user_id=$1',[alice])).rows.length,0);
        await assert.rejects(save({...base,discordHiddenBadges:['house-bravery']}),error=>error.code==='42501');
        assert.equal((await own()).owner,'bob');
        assert.deepEqual((await save({nickname:'Bob',discordHiddenBadges:['server-booster']})).discordHiddenBadges,['server-booster']);
      });
      await as('anon',null,async()=>{
        await assert.rejects(save({discordHiddenBadges:['house-bravery']}),error=>error.code==='42501');
        await assert.rejects(db.query('select private.profile_discord_badges($1::jsonb)',['["house-bravery"]']),error=>error.code==='42501');
        assert.ok(Array.isArray((await db.query('select settings from public.profile_published where username=$1',['alice'])).rows[0].settings.discordHiddenBadges));
      });
    });
  }finally{await db.close();}
});
