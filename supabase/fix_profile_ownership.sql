-- Supabase SQL Editor에서 한 번 실행하세요.
-- 기존 방의 누락된 기본 사진/소유자 표시를 채우고, 확인된 sailo의 복사 사진을 기본 사진으로 되돌립니다.
with parsed as (
  select
    id,
    handle,
    data,
    coalesce(nullif(data ->> 'my-room-profile-v1', '')::jsonb, '{}'::jsonb) as profile
  from public.rooms
), gyuh_photo as (
  select profile ->> 'photo' as photo
  from parsed
  where handle = 'gyuh'
), normalized as (
  select
    id,
    data,
    profile || jsonb_build_object(
      'handle', handle,
      'photoOwner', handle,
      'photo', case
        when handle = 'sailo' and profile ->> 'photo' = (select photo from gyuh_photo) then 'default-profile.svg'
        when nullif(profile ->> 'photo', '') is null then 'default-profile.svg'
        else profile ->> 'photo'
      end,
      'total', coalesce((profile ->> 'total')::int, 0),
      'today', coalesce((profile ->> 'today')::int, 0),
      'lastVisit', coalesce(profile ->> 'lastVisit', current_date::text),
      'friends', coalesce((profile ->> 'friends')::int, 0)
    ) as profile
  from parsed
)
update public.rooms as room
set data = jsonb_set(room.data, '{my-room-profile-v1}', to_jsonb(normalized.profile::text), true)
from normalized
where room.id = normalized.id;

select
  handle,
  (data ->> 'my-room-profile-v1')::jsonb ->> 'handle' as profile_handle,
  (data ->> 'my-room-profile-v1')::jsonb ->> 'photoOwner' as photo_owner,
  coalesce(nullif((data ->> 'my-room-profile-v1')::jsonb ->> 'photo', ''), 'MISSING') as photo
from public.rooms
order by handle;
