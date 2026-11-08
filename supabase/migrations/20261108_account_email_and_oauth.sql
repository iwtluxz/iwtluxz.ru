-- Apply in Supabase SQL Editor. Existing usernames, profiles and publications stay intact.
-- Also deploy functions/account-login before enabling email binding in the site.
begin;

create or replace function private.profile_validate_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_username text; owner_code text; claimed_username text;
begin
  if jsonb_typeof(coalesce(new.raw_user_meta_data, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'Некорректные данные регистрации.';
  end if;
  -- Provider is Auth-managed app metadata, never user-editable metadata.
  -- OAuth users choose a free page address after returning from their provider.
  if new.raw_app_meta_data->>'provider' in ('google','discord') then
    new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'owner_claim';
    return new;
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
  if new.raw_app_meta_data->>'provider' in ('google','discord') then return new; end if;
  insert into public.profile_accounts(user_id, username)
    values (new.id, private.profile_username(new.raw_user_meta_data->>'username'));
  return new;
end;
$$;

create or replace function private.profile_keep_login()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The page address lives in profile_accounts and is independent of the email.
  -- Auth performs the ownership/confirmation checks for updateUser and its callback.
  if new.email is distinct from old.email and exists(select 1 from public.profile_accounts where user_id = old.id)
     and (coalesce(new.email,'') = '' or lower(new.email) like '%@accounts.iwtxz.ru') then
    raise exception using errcode = '22023', message = 'Укажи настоящую почту для восстановления аккаунта.';
  end if;
  return new;
end;
$$;

create or replace function public.builder_complete_oauth_profile(requested_username text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_username text; existing_username text;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Сначала войди через Google или Discord.'; end if;
  -- Serialize competing requests for one user. Never reassign an existing address.
  perform 1 from auth.users where id = v_user_id for update;
  select username into existing_username from public.profile_accounts where user_id = v_user_id;
  if existing_username is not null then return jsonb_build_object('username',existing_username); end if;
  if not exists(select 1 from auth.identities where user_id = v_user_id and provider in ('google','discord')) then
    raise exception using errcode = '42501', message = 'Для создания страницы нужен вход через Google или Discord.';
  end if;
  v_username := private.profile_username(requested_username);
  if private.profile_reserved(v_username) then
    raise exception using errcode = '42501', message = 'Этот логин закреплён за владельцем. Выбери другой адрес.';
  end if;
  insert into public.profile_accounts(user_id,username) values(v_user_id,v_username);
  return jsonb_build_object('username',v_username);
end;
$$;
revoke all on function public.builder_complete_oauth_profile(text) from public, anon, authenticated;
grant execute on function public.builder_complete_oauth_profile(text) to authenticated;

-- Only the server-side login function can resolve private email addresses.
-- There is deliberately no public username-to-email endpoint.
create or replace function public.builder_private_login_email(requested_username text)
returns text language sql stable security definer set search_path = '' as $$
  select u.email from public.profile_accounts a join auth.users u on u.id=a.user_id
    where a.username=lower(btrim(requested_username));
$$;
revoke all on function public.builder_private_login_email(text) from public, anon, authenticated;
grant execute on function public.builder_private_login_email(text) to service_role;

create table if not exists private.profile_login_attempts(
  key_hash text primary key check(key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null default now(),
  attempts integer not null default 1
);
alter table private.profile_login_attempts enable row level security;
revoke all on private.profile_login_attempts from public, anon, authenticated;

create or replace function public.builder_private_login_attempt(attempt_keys text[])
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_key text; allowed boolean := true; attempt_count integer;
begin
  if coalesce(array_length(attempt_keys,1),0) not between 1 and 2 then return false; end if;
  -- Sorted keys keep concurrent IP/account checks in one consistent lock order.
  for v_key in select distinct unnest(attempt_keys) order by 1 loop
    if v_key is null or v_key !~ '^[a-f0-9]{64}$' then return false; end if;
    insert into private.profile_login_attempts(key_hash) values(v_key)
    on conflict(key_hash) do update set
      attempts=case when private.profile_login_attempts.window_start < now()-interval '5 minutes' then 1 else private.profile_login_attempts.attempts+1 end,
      window_start=case when private.profile_login_attempts.window_start < now()-interval '5 minutes' then now() else private.profile_login_attempts.window_start end
    returning attempts into attempt_count;
    if attempt_count > 12 then allowed := false; end if;
  end loop;
  -- Bounded cleanup; keys contain only server-peppered hashes, no addresses/passwords.
  delete from private.profile_login_attempts where key_hash in
    (select key_hash from private.profile_login_attempts where window_start < now()-interval '1 day' limit 100);
  return allowed;
end;
$$;
revoke all on function public.builder_private_login_attempt(text[]) from public, anon, authenticated;
grant execute on function public.builder_private_login_attempt(text[]) to service_role;

notify pgrst,'reload schema';
commit;
