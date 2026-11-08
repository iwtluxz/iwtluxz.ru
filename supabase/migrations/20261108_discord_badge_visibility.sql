-- Per-badge visibility for badges received from Discord. Existing profiles are not rewritten.
-- Apply after 20261108_discord_badge_catalog.sql. Safe to apply again.
begin;

do $$ begin
  if to_regprocedure('private.profile_discord_badges(jsonb)') is null then
    raise exception 'Apply 20261108_discord_badge_catalog.sql before this migration.';
  end if;
end $$;

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
  result := result || jsonb_build_object('backgroundEffect','none','effectIntensity',50,
    'profileTilt',false,'cursorStyle','default','customCursor','','favicon','', 'avatarFit','cover');
  result := result || jsonb_build_object('profileScale',100,'nicknameSize',32,'discordShowCopyHint',true);
  result := result || jsonb_build_object('descriptionSize',16,'cursorSize',24,'cursorOpacity',100,'cursorColor','#ffffff',
    'cursorHotspot','center','typewriterEnabled',false,'typewriterText','','typewriterSpeed',70,
    'seasonalTheme','none','objectPositions','{}'::jsonb);
  result := result || jsonb_build_object('descriptionAnimation','none','layoutVersion',2);
  if username not in ('iwtlu','shakzy','strelokk') then
    result := result || jsonb_build_object('avatar','','background','','music','','musicTitle','','musicCover','');
  end if;
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
  result := result || jsonb_build_object('discordBadges', case
    when username='iwtlu' then '["nitro","house-bravery","server-booster","active-developer"]'::jsonb
    when username in ('shakzy','strelokk') then '["nitro","house-bravery"]'::jsonb
    else '[]'::jsonb end);
  result := result || jsonb_build_object('discordHiddenBadges','[]'::jsonb);
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
  positions jsonb := '{}'::jsonb;
  point jsonb;
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
  foreach value in array array['avatar','background','music','musicCover','customFont','customCursor','favicon'] loop
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
  if value not in ('none','glow','pulse','float','shimmer','glitch','typewriter','blur','flicker','bounce','wave','neon','rainbow','outline','scanline','spotlight','echo','orbit','heartbeat') then
    raise exception using errcode = '22023', message = 'Неизвестная анимация ника.';
  end if;
  result := result || jsonb_build_object('nicknameAnimation', value);
  value := private.profile_text(input,'descriptionAnimation','none',20);
  if value not in ('none','glow','pulse','float','shimmer','reveal','flicker','wave','gradient') then
    raise exception using errcode='22023',message='Неизвестная анимация описания.';
  end if;
  result := result || jsonb_build_object('descriptionAnimation',value,'layoutVersion',private.profile_number(input,'layoutVersion',1,1,2));
  value := private.profile_text(input, 'avatarDecoration', 'none', 24);
  if value not in ('none','discord','phoenix','heartbloom','shy','sakura','moon','embers','aurora','cat','rainbow','firecrackers','flame-sword','steampunk-cat','potion','lotus','snowglobe','bubble-tea','black-hole','ufo','fox-hat','lovestruck','crystal-ball','hex-lights','solar-orbit','honeyblossom','heartstrings','chromawave','koi','portal-blue','cozy-cat','lightning','constellations','head-clouds','strawberry','neon-cat','runes','rainy-mood','glitch-frame') then
    raise exception using errcode = '22023', message = 'Неизвестное украшение аватара.';
  end if;
  result := result || jsonb_build_object('avatarDecoration', value, 'profileBadges', badges, 'settingsVersion', 7);
  result := result || jsonb_build_object('profileScale',private.profile_number(input,'profileScale',100,70,120),'nicknameSize',private.profile_number(input,'nicknameSize',32,18,52),'discordShowCopyHint',private.profile_boolean(input,'discordShowCopyHint',true));
  result := result || jsonb_build_object('descriptionSize',private.profile_number(input,'descriptionSize',16,10,32),
    'cursorSize',private.profile_number(input,'cursorSize',24,12,96),
    'cursorOpacity',private.profile_number(input,'cursorOpacity',100,20,100),
    'typewriterSpeed',private.profile_number(input,'typewriterSpeed',70,20,200),
    'typewriterEnabled',private.profile_boolean(input,'typewriterEnabled',false),
    'typewriterText',private.profile_text(input,'typewriterText','',300));
  value := private.profile_text(input,'cursorColor','#ffffff',7);
  if value !~ '^#[a-fA-F0-9]{6}$' then raise exception using errcode='22023',message='Некорректный цвет курсора.'; end if;
  result := result || jsonb_build_object('cursorColor',lower(value));
  value := private.profile_text(input,'cursorHotspot','center',12);
  if value not in ('center','top-left') then raise exception using errcode='22023',message='Неизвестная точка курсора.'; end if;
  result := result || jsonb_build_object('cursorHotspot',value);
  value := private.profile_text(input,'seasonalTheme','none',12);
  if value not in ('none','halloween') then raise exception using errcode='22023',message='Неизвестная тема.'; end if;
  result := result || jsonb_build_object('seasonalTheme',value);
  if input ? 'objectPositions' then
    if jsonb_typeof(input->'objectPositions') <> 'object' then raise exception using errcode='22023',message='Некорректное расположение блоков.'; end if;
    for item in select * from jsonb_each(input->'objectPositions') loop
      point := item.value;
      if item.key not in ('avatar','name','description','socials','discord','player','typewriter') or jsonb_typeof(point) <> 'object' then
        raise exception using errcode='22023',message='Неизвестный блок страницы.';
      end if;
      if not (point ? 'x' and point ? 'y') or (point - 'x' - 'y') <> '{}'::jsonb then
        raise exception using errcode='22023',message='Укажи координаты блока.';
      end if;
      if jsonb_typeof(point->'x') <> 'number' or jsonb_typeof(point->'y') <> 'number' then
        raise exception using errcode='22023',message='Координаты должны быть числами.';
      end if;
      if abs((point->>'x')::numeric) > 40 or abs((point->>'y')::numeric) > 40 then
        raise exception using errcode='22023',message='Блок выходит за допустимые границы.';
      end if;
      positions := positions || jsonb_build_object(item.key,jsonb_build_object('x',round((point->>'x')::numeric,2),'y',round((point->>'y')::numeric,2)));
    end loop;
  end if;
  result := result || jsonb_build_object('objectPositions',positions);
  value := private.profile_text(input,'backgroundEffect','none',16);
  if value not in ('none','snow','rain','matrix','glitch','parallax') then raise exception using errcode='22023',message='Неизвестный эффект фона.'; end if;
  result := result || jsonb_build_object('backgroundEffect',value,'effectIntensity',private.profile_number(input,'effectIntensity',50,10,100),'profileTilt',private.profile_boolean(input,'profileTilt',false));
  value := private.profile_text(input,'cursorStyle','default',16);
  if value not in ('default','dot','ring','crosshair') then raise exception using errcode='22023',message='Неизвестный курсор.'; end if;
  result := result || jsonb_build_object('cursorStyle',value);
  value := private.profile_text(input,'avatarFit','cover',12);
  if value not in ('cover','contain') then raise exception using errcode='22023',message='Неизвестный вид аватара.'; end if;
  result := result || jsonb_build_object('avatarFit',value);
  foreach value in array array['nicknameGradient','discordSync','discordUseAvatar','discordShowStatus','discordShowBadges','discordShowActivity','showButterfly'] loop
    result := result || jsonb_build_object(value, private.profile_boolean(input, value, coalesce((defaults->>value)::boolean, false)));
  end loop;
  result := result || jsonb_build_object('discordBadges',private.profile_discord_badges(coalesce(input->'discordBadges',defaults->'discordBadges','[]'::jsonb)));
  result := result || jsonb_build_object('discordHiddenBadges',private.profile_discord_badges(coalesce(input->'discordHiddenBadges',defaults->'discordHiddenBadges','[]'::jsonb)));
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
  select jsonb_build_object('profileSettingsVersion', 7, 'customFonts', true, 'profileEffects', true, 'interactiveEffects', true,'profileLayout',true,'freeLayout',true,'editorV2',true,'discordBadges',true,'discordBadgeVisibility',true);
$$;

revoke all on function private.profile_default(text),private.profile_normalize(jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.builder_capabilities() from public;
grant execute on function public.builder_capabilities() to anon,authenticated;
notify pgrst, 'reload schema';
commit;
