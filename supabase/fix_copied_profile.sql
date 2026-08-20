-- peterjm007에 itsme 프로필 전체가 복사된 현재 데이터만 복구한다.
-- 사진 값이 여전히 서로 같을 때만 실행되므로 사용자가 이후 새 사진을 올렸다면 건드리지 않는다.
with source as (
  select ((data ->> 'my-room-profile-v1')::jsonb ->> 'photo') as photo
  from public.rooms
  where handle = 'itsme'
)
update public.rooms
set data = jsonb_set(
  data,
  '{my-room-profile-v1}',
  to_jsonb(jsonb_build_object(
    'handle', 'peterjm007',
    'total', 0,
    'today', 0,
    'lastVisit', current_date::text,
    'friends', 0
  )::text)
)
where handle = 'peterjm007'
  and ((data ->> 'my-room-profile-v1')::jsonb ->> 'photo') = (select photo from source)
  and (select photo from source) is not null;

-- 실행 결과 확인
select
  handle,
  (data ->> 'my-room-profile-v1')::jsonb as profile
from public.rooms
where handle in ('itsme', 'peterjm007')
order by handle;
