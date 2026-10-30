-- Run once in the SQL Editor of a dedicated Supabase project, as postgres.
-- Safe to run again: existing profiles and uploaded files are retained.
-- Auth configuration: enable password sign-ups and DISABLE Confirm email.
-- Addresses in accounts.iwtxz.ru are login aliases, never real mailboxes.
begin;

create schema if not exists private;

create table if not exists public.profile_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  created_at timestamptz not null default now()
);
create table if not exists public.profile_drafts (
  user_id uuid primary key references public.profile_accounts(user_id) on delete cascade,
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now()
);
create table if not exists public.profile_published (
  username text primary key references public.profile_accounts(username) on delete cascade,
  user_id uuid not null unique references public.profile_accounts(user_id) on delete cascade,
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  published_at timestamptz not null default now()
);
create table if not exists private.profile_owner_claims (
  username text primary key,
  token_hash text not null,
  expires_at timestamptz not null,
  used_by uuid,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profile_accounts enable row level security;
alter table public.profile_drafts enable row level security;
alter table public.profile_published enable row level security;
alter table private.profile_owner_claims enable row level security;
revoke all on public.profile_accounts, public.profile_drafts, public.profile_published from public, anon, authenticated;
revoke all on private.profile_owner_claims from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.profile_accounts, public.profile_drafts to authenticated;
grant select (username, settings, published_at) on public.profile_published to anon, authenticated;

drop policy if exists iwtxz_accounts_read_own on public.profile_accounts;
create policy iwtxz_accounts_read_own on public.profile_accounts for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists iwtxz_drafts_read_own on public.profile_drafts;
create policy iwtxz_drafts_read_own on public.profile_drafts for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists iwtxz_published_read on public.profile_published;
create policy iwtxz_published_read on public.profile_published for select to anon, authenticated using (true);

create or replace function private.profile_username(value text)
returns text language plpgsql immutable set search_path = '' as $$
declare result text := lower(btrim(coalesce(value, '')));
begin
  if result !~ '^[a-z0-9][a-z0-9_-]{2,31}$' then
    raise exception using errcode = '22023', message = 'Логин: 3–32 латинские буквы, цифры, _ и -; первый символ — буква или цифра.';
  end if;
  return case when result = 'strelok' then 'strelokk' else result end;
end;
$$;
create or replace function private.profile_reserved(value text)
returns boolean language sql immutable set search_path = '' as $$
  select value = any(array['iwtlu','shakzy','strelokk','strelok','icetearz','eris','admin','api','index','assets']);
$$;

-- Run SELECT private.issue_owner_claim('iwtlu') in the SQL Editor.
-- The returned code is shown once: use it in the owner's registration form.
-- This function is intentionally NOT callable through the public Data API.
create or replace function private.issue_owner_claim(requested_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_username text := private.profile_username(requested_username);
  token text;
begin
  if not private.profile_reserved(v_username) then
    raise exception using errcode = '22023', message = 'Код владельца нужен только для существующего профиля.';
  end if;
  if exists(select 1 from public.profile_accounts a where a.username = v_username) then
    raise exception using errcode = '23505', message = 'Аккаунт этого владельца уже создан.';
  end if;
  token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into private.profile_owner_claims(username, token_hash, expires_at)
    values (v_username, encode(sha256(convert_to(token, 'UTF8')), 'hex'), now() + interval '24 hours')
  on conflict (username) do update set token_hash = excluded.token_hash,
    expires_at = excluded.expires_at, used_by = null, used_at = null, created_at = now();
  return token;
end;
$$;
revoke all on function private.issue_owner_claim(text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.issue_owner_claim(text) to service_role;

create or replace function private.profile_validate_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_username text;
  owner_code text;
  claimed_username text;
begin
  if jsonb_typeof(coalesce(new.raw_user_meta_data, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'Некорректные данные регистрации.';
  end if;
  v_username := private.profile_username(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)));
  if lower(coalesce(new.email, '')) <> v_username || '@accounts.iwtxz.ru' then
    raise exception using errcode = '22023', message = 'Используйте регистрацию с логином в кабинете iwtxz.';
  end if;
  if private.profile_reserved(v_username) and coalesce(new.raw_app_meta_data->>'profile_owner', 'false') <> 'true' then
    owner_code := coalesce(new.raw_user_meta_data->>'owner_claim', '');
    if owner_code !~ '^[a-f0-9]{64}$' then
      raise exception using errcode = '42501', message = 'Этот логин закреплён за владельцем. Нужен код владельца.';
    end if;
    update private.profile_owner_claims c set used_by = new.id, used_at = now()
      where c.username = v_username and c.used_at is null and c.expires_at > now()
        and c.token_hash = encode(sha256(convert_to(owner_code, 'UTF8')), 'hex')
      returning c.username into claimed_username;
    if claimed_username is null then
      raise exception using errcode = '42501', message = 'Код владельца неверный, уже использован или истёк.';
    end if;
  end if;
  new.raw_user_meta_data := (coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'owner_claim') || jsonb_build_object('username', v_username);
  return new;
end;
$$;
create or replace function private.profile_create_auth_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profile_accounts(user_id, username)
    values (new.id, private.profile_username(new.raw_user_meta_data->>'username'));
  return new;
end;
$$;
create or replace function private.profile_keep_login()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email and exists(select 1 from public.profile_accounts where user_id = old.id) then
    raise exception using errcode = '22023', message = 'Логин аккаунта нельзя изменить.';
  end if;
  return new;
end;
$$;
drop trigger if exists iwtxz_validate_auth_user on auth.users;
create trigger iwtxz_validate_auth_user before insert on auth.users for each row execute function private.profile_validate_auth_user();
drop trigger if exists iwtxz_create_auth_account on auth.users;
create trigger iwtxz_create_auth_account after insert on auth.users for each row execute function private.profile_create_auth_account();
drop trigger if exists iwtxz_keep_auth_login on auth.users;
create trigger iwtxz_keep_auth_login before update of email on auth.users for each row execute function private.profile_keep_login();
revoke all on function private.profile_username(text), private.profile_reserved(text), private.profile_validate_auth_user(), private.profile_create_auth_account(), private.profile_keep_login() from public, anon, authenticated;

create or replace function private.profile_default(username text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare result jsonb;
begin
  result := jsonb_build_object(
    'id', username, 'owner', username, 'title', username, 'nickname', username,
    'description', '', 'discord', '', 'telegram', '', 'steam', '',
    'avatar', 'img/mainavatar.gif?v=753a752807b3', 'background', 'img/background.mp4', 'backgroundType', 'video',
    'music', 'sound/sound.mp3?v=146f58f1ac20', 'musicTitle', 'one more time', 'musicCover', 'img/mysoundicon.png?v=452f20b76fc7',
    'avatarSize', 150, 'backgroundDim', 58, 'accentColor', '#f5f5f7', 'font', 'minecraft',
    'entryText', 'click to enter...', 'showDiscord', true, 'musicLoop', true,
    'customFont', '', 'musicPlayerStyle', 'classic', 'avatarShape', 'circle',
    'nicknameGradient', false, 'nicknameGradientStart', '#ffffff', 'nicknameGradientEnd', '#a1a1aa', 'nicknameGradientAngle', 90,
    'discordUserId', '', 'discordSync', false, 'discordCardStyle', 'glass', 'discordCardColor', '#111111',
    'discordCardOpacity', 65, 'discordCardRadius', 18, 'discordUseAvatar', true,
    'discordShowStatus', true, 'discordShowBadges', true, 'discordShowActivity', true,
    'showButterfly', false, 'profileBadges', '[]'::jsonb, 'settingsVersion', 3,
    'publicUrl', '/profile.html?u=' || username,
    'updatedAt', floor(extract(epoch from now()) * 1000)::bigint
  );
  result := result || jsonb_build_object('nicknameAnimation', 'none', 'avatarDecoration', 'none',
    'vk', '', 'youtube', '', 'twitch', '', 'tiktok', '', 'instagram', '', 'github', '',
    'spotify', '', 'x', '', 'soundcloud', '', 'reddit', '', 'boosty', '', 'website', '');
  if username = 'iwtlu' then result := result || jsonb_build_object(
    'nickname', 'Ɨ ω ŧ Ł υ', 'description', 'малыш, ты знала, что все закончится так',
    'discord', 'iwtluz', 'telegram', 'https://t.me/iwtluz', 'steam', 'https://steamcommunity.com/id/meintofores');
  elsif username = 'shakzy' then result := result || jsonb_build_object(
    'description', 'Respect the past, create the future', 'discord', 'mrshakzzy',
    'avatar', 'img/avatar_shakzy.jpg', 'background', 'img/gif_shakzy.gif', 'backgroundType', 'image',
    'music', 'sound/sound2.mp3', 'musicTitle', 'RJ Pasin - Chad', 'musicCover', 'img/shakzysoundicon.png');
  elsif username = 'strelokk' then result := result || jsonb_build_object(
    'description', 'The only way to do great work is to love what you do', 'discord', 'phantom576.',
    'avatar', 'img/strelokkavatar.gif', 'background', 'img/artem.gif', 'backgroundType', 'image',
    'music', 'sound/sound1.mp3', 'musicTitle', 'whitek3d - STATUS', 'musicCover', 'img/strelokksoundicon.png');
  end if;
  return result;
end;
$$;

create or replace function private.profile_text(input jsonb, key text, fallback text, maximum integer)
returns text language plpgsql immutable set search_path = '' as $$
declare value text;
begin
  if not input ? key then return fallback; end if;
  if jsonb_typeof(input->key) <> 'string' then raise exception using errcode = '22023', message = 'Некорректное текстовое поле: ' || key; end if;
  value := btrim(input->>key);
  if char_length(value) > maximum then raise exception using errcode = '22023', message = 'Слишком длинное поле: ' || key; end if;
  return value;
end;
$$;
create or replace function private.profile_https(value text)
returns boolean language sql immutable set search_path = '' as $$
  select value ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$';
$$;
create or replace function private.profile_asset(value text, user_id uuid)
returns text language plpgsql immutable set search_path = '' as $$
declare match text[];
begin
  if value = '' then return value; end if;
  if value ~ '^/?(img|sound|font)/[A-Za-z0-9_./-]+([?][A-Za-z0-9_=&.-]*)?$'
    and split_part(value, '?', 1) !~ '(^|/)[.][.](/|$)' then return value; end if;
  if not private.profile_https(value) then raise exception using errcode = '22023', message = 'Неверная ссылка на файл.'; end if;
  if value like '%/storage/v1/object/public/profile-assets/%' then
    match := regexp_match(value, '^https://[^/]+/storage/v1/object/public/profile-assets/([a-f0-9-]{36})/[a-f0-9]{32}[.](png|jpg|jpeg|gif|webp|mp3|ogg|wav|m4a|mp4|webm|woff|woff2|ttf|otf)$');
    if match is null or match[1] <> user_id::text then raise exception using errcode = '42501', message = 'Можно использовать только свои загруженные файлы.'; end if;
  end if;
  return value;
end;
$$;
create or replace function private.profile_number(input jsonb, key text, fallback integer, minimum integer, maximum integer)
returns integer language plpgsql immutable set search_path = '' as $$
declare value numeric;
begin
  if not input ? key then return fallback; end if;
  if jsonb_typeof(input->key) <> 'number' then raise exception using errcode = '22023', message = 'Некорректное числовое поле: ' || key; end if;
  value := (input->>key)::numeric;
  if value < minimum or value > maximum then raise exception using errcode = '22023', message = 'Значение вне допустимого диапазона: ' || key; end if;
  return round(value)::integer;
end;
$$;
create or replace function private.profile_boolean(input jsonb, key text, fallback boolean)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if not input ? key then return fallback; end if;
  if jsonb_typeof(input->key) <> 'boolean' then raise exception using errcode = '22023', message = 'Некорректный переключатель: ' || key; end if;
  return (input->>key)::boolean;
end;
$$;
create or replace function private.profile_normalize(input jsonb, username text, user_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  defaults jsonb := private.profile_default(username);
  result jsonb;
  item record;
  value text;
  badge jsonb;
  badges jsonb := '[]'::jsonb;
begin
  if input is null or jsonb_typeof(input) <> 'object' or octet_length(input::text) > 32768 then
    raise exception using errcode = '22023', message = 'Некорректные настройки страницы.';
  end if;
  if (input ? 'id' and input->>'id' <> username) or (input ? 'owner' and input->>'owner' <> username) then
    raise exception using errcode = '42501', message = 'Можно изменять только свою страницу.';
  end if;
  result := jsonb_build_object('id', username, 'owner', username, 'publicUrl', '/profile.html?u=' || username,
    'updatedAt', floor(extract(epoch from now()) * 1000)::bigint);
  for item in select * from (values ('title',80),('nickname',40),('description',500),('discord',60),('musicTitle',100),('entryText',80)) as fields(key, maximum) loop
    value := private.profile_text(input, item.key, defaults->>item.key, item.maximum);
    if value = '' and item.key in ('title','nickname') then value := username; end if;
    if value = '' and item.key = 'entryText' then value := defaults->>item.key; end if;
    result := result || jsonb_build_object(item.key, value);
  end loop;
  foreach value in array array['telegram','steam','vk','youtube','twitch','tiktok','instagram','github','spotify','x','soundcloud','reddit','boosty','website'] loop
    result := result || jsonb_build_object(value, private.profile_text(input, value, '', 500));
    if result->>value <> '' and not private.profile_https(result->>value) then
      raise exception using errcode = '22023', message = 'Ссылки на соцсети должны начинаться с https://.';
    end if;
  end loop;
  foreach value in array array['avatar','background','music','musicCover','customFont'] loop
    result := result || jsonb_build_object(value, private.profile_asset(private.profile_text(input, value, defaults->>value, 2048), user_id));
  end loop;
  value := private.profile_text(input, 'backgroundType', defaults->>'backgroundType', 10);
  if value not in ('image','video') then raise exception using errcode = '22023', message = 'Неизвестный тип фона.'; end if;
  result := result || jsonb_build_object('backgroundType', value);
  value := private.profile_text(input, 'font', defaults->>'font', 20);
  if value not in ('minecraft','system','custom') then raise exception using errcode = '22023', message = 'Неизвестный шрифт.'; end if;
  result := result || jsonb_build_object('font', value);
  for item in select * from (values ('accentColor','#f5f5f7'),('nicknameGradientStart','#ffffff'),('nicknameGradientEnd','#a1a1aa'),('discordCardColor','#111111')) as colors(key, fallback) loop
    value := private.profile_text(input, item.key, item.fallback, 7);
    if value !~ '^#[a-fA-F0-9]{6}$' then raise exception using errcode = '22023', message = 'Некорректный цвет: ' || item.key; end if;
    result := result || jsonb_build_object(item.key, lower(value));
  end loop;
  value := private.profile_text(input, 'musicPlayerStyle', 'classic', 12);
  if value not in ('classic','compact') then raise exception using errcode = '22023', message = 'Неизвестный вид плеера.'; end if;
  result := result || jsonb_build_object('musicPlayerStyle', value);
  value := private.profile_text(input, 'avatarShape', 'circle', 12);
  if value not in ('circle','rounded','square') then raise exception using errcode = '22023', message = 'Неизвестная форма аватарки.'; end if;
  result := result || jsonb_build_object('avatarShape', value);
  value := private.profile_text(input, 'discordCardStyle', 'glass', 12);
  if value not in ('glass','solid','minimal') then raise exception using errcode = '22023', message = 'Неизвестный вид карточки Discord.'; end if;
  result := result || jsonb_build_object('discordCardStyle', value);
  value := private.profile_text(input, 'discordUserId', '', 20);
  if value <> '' and value !~ '^[0-9]{17,20}$' then raise exception using errcode = '22023', message = 'ID Discord должен содержать от 17 до 20 цифр.'; end if;
  result := result || jsonb_build_object('discordUserId', value);
  if input ? 'profileBadges' then
    if jsonb_typeof(input->'profileBadges') <> 'array' or jsonb_array_length(input->'profileBadges') > 7 then
      raise exception using errcode = '22023', message = 'Некорректный список украшений.';
    end if;
    for badge in select * from jsonb_array_elements(input->'profileBadges') loop
      if jsonb_typeof(badge) <> 'string' or (badge #>> '{}') not in ('star','heart','moon','sparkle','code','music','flower') then
        raise exception using errcode = '22023', message = 'Неизвестное украшение профиля.';
      end if;
      if not badges @> jsonb_build_array(badge) then badges := badges || jsonb_build_array(badge); end if;
    end loop;
  end if;
  value := private.profile_text(input, 'nicknameAnimation', 'none', 20);
  if value not in ('none','glow','pulse','float','shimmer','glitch','typewriter','blur','flicker','bounce','wave') then
    raise exception using errcode = '22023', message = 'Неизвестная анимация ника.';
  end if;
  result := result || jsonb_build_object('nicknameAnimation', value);
  value := private.profile_text(input, 'avatarDecoration', 'none', 24);
  if value not in ('none','discord','phoenix','heartbloom','shy','sakura','moon','embers','aurora','cat') then
    raise exception using errcode = '22023', message = 'Неизвестное украшение аватара.';
  end if;
  result := result || jsonb_build_object('avatarDecoration', value, 'profileBadges', badges, 'settingsVersion', 3);
  foreach value in array array['nicknameGradient','discordSync','discordUseAvatar','discordShowStatus','discordShowBadges','discordShowActivity','showButterfly'] loop
    result := result || jsonb_build_object(value, private.profile_boolean(input, value, coalesce((defaults->>value)::boolean, false)));
  end loop;
  return result || jsonb_build_object(
    'avatarSize', private.profile_number(input, 'avatarSize',150,80,220),
    'backgroundDim', private.profile_number(input, 'backgroundDim',58,0,85),
    'nicknameGradientAngle', private.profile_number(input, 'nicknameGradientAngle',90,0,360),
    'discordCardOpacity', private.profile_number(input, 'discordCardOpacity',65,0,100),
    'discordCardRadius', private.profile_number(input, 'discordCardRadius',18,0,32),
    'showDiscord', private.profile_boolean(input,'showDiscord',true),
    'musicLoop', private.profile_boolean(input,'musicLoop',true));
end;
$$;

create or replace function public.builder_capabilities()
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('profileSettingsVersion', 3, 'customFonts', true, 'profileEffects', true);
$$;
revoke all on function public.builder_capabilities() from public;
grant execute on function public.builder_capabilities() to anon, authenticated;

create or replace function public.builder_get_profile()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_username text; result jsonb; v_published_at timestamptz;
begin
  select a.username into v_username from public.profile_accounts a where a.user_id = v_user_id;
  if v_username is null then raise exception using errcode = '42501', message = 'Сначала войдите в аккаунт.'; end if;
  select d.settings into result from public.profile_drafts d where d.user_id = v_user_id;
  result := coalesce(result, private.profile_default(v_username));
  select p.published_at into v_published_at from public.profile_published p where p.user_id = v_user_id;
  return result || jsonb_build_object('publishedAt', case when v_published_at is null then null else floor(extract(epoch from v_published_at) * 1000)::bigint end);
end;
$$;
create or replace function public.builder_save_profile(input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_username text; result jsonb;
begin
  select a.username into v_username from public.profile_accounts a where a.user_id = v_user_id;
  if v_username is null then raise exception using errcode = '42501', message = 'Сначала войдите в аккаунт.'; end if;
  result := private.profile_normalize(input, v_username, v_user_id);
  insert into public.profile_drafts(user_id, settings) values(v_user_id, result)
    on conflict (user_id) do update set settings = excluded.settings, updated_at = now();
  return public.builder_get_profile();
end;
$$;
create or replace function public.builder_publish_profile()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_username text; result jsonb; v_published_at timestamptz := now(); stamp bigint;
begin
  select a.username into v_username from public.profile_accounts a where a.user_id = v_user_id;
  if v_username is null then raise exception using errcode = '42501', message = 'Сначала войдите в аккаунт.'; end if;
  select d.settings into result from public.profile_drafts d where d.user_id = v_user_id for update;
  if result is null then raise exception using errcode = '22023', message = 'Сначала сохраните черновик страницы.'; end if;
  stamp := floor(extract(epoch from v_published_at) * 1000)::bigint;
  result := private.profile_normalize(result, v_username, v_user_id) || jsonb_build_object('publishedAt', stamp);
  insert into public.profile_published(username, user_id, settings, published_at) values(v_username, v_user_id, result, v_published_at)
    on conflict (username) do update set settings = excluded.settings, published_at = excluded.published_at;
  return jsonb_build_object('ok', true, 'slug', v_username, 'url', '/profile.html?u=' || v_username, 'publishedAt', stamp);
end;
$$;
create or replace function public.builder_delete_profile()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists(select 1 from public.profile_accounts a where a.user_id = v_user_id) then
    raise exception using errcode = '42501', message = 'Сначала войдите в аккаунт.';
  end if;
  delete from public.profile_drafts d where d.user_id = v_user_id;
  delete from public.profile_published p where p.user_id = v_user_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function private.profile_default(text), private.profile_text(jsonb,text,text,integer), private.profile_https(text), private.profile_asset(text,uuid), private.profile_number(jsonb,text,integer,integer,integer), private.profile_boolean(jsonb,text,boolean), private.profile_normalize(jsonb,text,uuid) from public, anon, authenticated;
revoke all on function public.builder_get_profile(), public.builder_save_profile(jsonb), public.builder_publish_profile(), public.builder_delete_profile() from public, anon, authenticated;
grant execute on function public.builder_get_profile(), public.builder_save_profile(jsonb), public.builder_publish_profile(), public.builder_delete_profile() to authenticated;

-- Public objects are readable by URL, but clients cannot list all uploads.
-- An existing private bucket is deliberately not made public by this setup.
do $$ begin
  if exists(select 1 from storage.buckets where id = 'profile-assets' and not public) then
    raise exception 'An existing private profile-assets bucket must not be exposed. Use a dedicated project or explicitly review its contents first.';
  end if;
end $$;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('profile-assets','profile-assets',true,4194304,array['image/png','image/jpeg','image/gif','image/webp','audio/mpeg','audio/mp3','audio/ogg','audio/wav','audio/x-wav','audio/mp4','audio/webm','video/mp4','video/webm','font/woff','font/woff2','font/ttf','font/otf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists iwtxz_assets_insert_own on storage.objects;
create policy iwtxz_assets_insert_own on storage.objects for insert to authenticated with check (
  bucket_id = 'profile-assets' and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[a-f0-9-]{36}/[a-f0-9]{32}[.](png|jpg|jpeg|gif|webp|mp3|ogg|wav|m4a|mp4|webm|woff|woff2|ttf|otf)$'
);
drop policy if exists iwtxz_assets_read_own on storage.objects;
create policy iwtxz_assets_read_own on storage.objects for select to authenticated using (
  bucket_id = 'profile-assets' and (storage.foldername(name))[1] = (select auth.uid())::text
);
drop policy if exists iwtxz_assets_delete_own on storage.objects;
create policy iwtxz_assets_delete_own on storage.objects for delete to authenticated using (
  bucket_id = 'profile-assets' and (storage.foldername(name))[1] = (select auth.uid())::text
);
drop policy if exists iwtxz_assets_guard on storage.objects;
create policy iwtxz_assets_guard on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'profile-assets' or (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id <> 'profile-assets' or (
    (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[a-f0-9-]{36}/[a-f0-9]{32}[.](png|jpg|jpeg|gif|webp|mp3|ogg|wav|m4a|mp4|webm|woff|woff2|ttf|otf)$'
  ));
drop policy if exists iwtxz_assets_anonymous_guard on storage.objects;
create policy iwtxz_assets_anonymous_guard on storage.objects as restrictive for all to anon
  using (bucket_id <> 'profile-assets') with check (bucket_id <> 'profile-assets');

notify pgrst, 'reload schema';
commit;
