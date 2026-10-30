-- Run in Supabase SQL Editor as postgres after 20261030_profile_customization.sql.
-- Adds nickname animations, original Discord avatar decorations and more social links.
-- Replaces validation/default functions only; existing profiles, publications and files are retained.
-- Safe to run again. Existing RLS policies and ownership checks remain in force.
begin;

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

revoke all on function private.profile_default(text), private.profile_normalize(jsonb,text,uuid) from public, anon, authenticated;
revoke all on function public.builder_capabilities() from public;
grant execute on function public.builder_capabilities() to anon, authenticated;
commit;
