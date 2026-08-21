-- 4개 콘셉트 방 적용
-- 대상: yamayao / byebyeya / smilely / peterjm007
-- 실행 전 Supabase SQL Editor에서 전체 파일을 한 번에 실행하세요.
-- 각 계정의 활성 방 배치와 색상만 교체하고, 다른 방과 나머지 room.data는 유지합니다.

begin;

do $$
begin
  if (select count(*) from public.rooms where handle in ('yamayao', 'byebyeya', 'smilely', 'peterjm007')) <> 4 then
    raise exception '대상 방 4개를 모두 찾지 못했습니다.';
  end if;
end $$;

create or replace function pg_temp.floor_item(
  item_id text, item_type text, cell_x integer, cell_y integer,
  cells_w integer, cells_d integer, turn double precision default 0,
  color_id text default null
) returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', item_id, 'type', item_type, 'surfaceId', 'floor',
    'gridX', cell_x, 'gridY', cell_y, 'gridZ', cell_y,
    'rotation', jsonb_build_array(0, turn, 0), 'scale', 1,
    'footprint', jsonb_build_object('width', cells_w, 'depth', cells_d),
    'resolution', 'base', 'styleId', color_id,
    'updatedAt', '2026-08-21T12:00:00.000Z'
  ));
$$;

create or replace function pg_temp.wall_item(
  item_id text, item_type text, wall_id text, cell_x integer, cell_y integer,
  cells_w integer, cells_h integer, turn double precision default 0,
  color_id text default null
) returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', item_id, 'type', item_type, 'surfaceId', wall_id, 'wallId', wall_id,
    'gridX', cell_x, 'gridY', cell_y,
    'rotation', jsonb_build_array(0, turn, 0), 'scale', 1,
    'footprint', jsonb_build_object('width', cells_w, 'depth', cells_h),
    'resolution', 'base', 'styleId', color_id,
    'updatedAt', '2026-08-21T12:00:00.000Z'
  ));
$$;

create or replace function pg_temp.surface_item(
  item_id text, item_type text, surface_id text, cell_x integer, cell_y integer,
  cells_w integer, cells_d integer, turn double precision default 0,
  color_id text default null
) returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', item_id, 'type', item_type, 'surfaceId', surface_id,
    'gridX', cell_x, 'gridY', cell_y,
    'rotation', jsonb_build_array(0, turn, 0), 'scale', 1,
    'footprint', jsonb_build_object('width', cells_w, 'depth', cells_d),
    'resolution', 'subgrid2', 'styleId', color_id,
    'updatedAt', '2026-08-21T12:00:00.000Z'
  ));
$$;

create temp table theme_room_updates (
  handle text primary key,
  concept text not null,
  items jsonb not null,
  style jsonb not null
) on commit drop;

insert into theme_room_updates values
(
  'yamayao',
  'Cozy Soft Room',
  jsonb_build_array(
    pg_temp.floor_item('bed', 'bed', 4, 0, 2, 3, 0, '#ead8d1'),
    pg_temp.floor_item('bookshelf', 'bookshelf', 0, 1, 2, 1, 1.5707963267948966, '#b99b7c'),
    pg_temp.floor_item('inventory-cozy-bedside', 'side-table', 3, 1, 1, 1, 0, '#d8c4ae'),
    pg_temp.floor_item('inventory-cozy-lamp', 'floor-lamp', 6, 1, 1, 1, 0, '#f1dfc4'),
    pg_temp.floor_item('inventory-cozy-beanbag', 'beanbag', 8, 5, 1, 1, 0, '#cf9a92'),
    pg_temp.floor_item('rug', 'rug', 3, 4, 3, 2, 0, '#e4c6c0'),
    pg_temp.floor_item('inventory-cozy-table', 'coffee-table', 4, 5, 2, 1, 0, '#c7aa8a'),
    pg_temp.floor_item('plant', 'plant', 1, 7, 1, 1, 0, '#8a9c82'),
    pg_temp.surface_item('inventory-cozy-mug', 'mug', 'inventory-cozy-table:top', 0, 0, 1, 1, 0, '#f3ead9'),
    pg_temp.surface_item('inventory-cozy-book', 'book-prop', 'inventory-cozy-table:top', 2, 0, 1, 1, 0, '#8a9c82'),
    pg_temp.wall_item('inventory-cozy-shelf', 'wall-shelf', 'leftWall', 3, 7, 3, 1, 0, '#b99b7c'),
    pg_temp.surface_item('inventory-cozy-candle', 'candle', 'inventory-cozy-shelf:top', 1, 0, 1, 1),
    pg_temp.surface_item('inventory-cozy-shelf-plant', 'potted-plant', 'inventory-cozy-shelf:top', 3, 0, 1, 1),
    pg_temp.wall_item('inventory-cozy-photo-a', 'photo-frame-2', 'rightWall', 2, 6, 2, 2),
    pg_temp.wall_item('photo', 'photo', 'rightWall', 4, 7, 1, 1),
    pg_temp.wall_item('inventory-cozy-photo-b', 'wall-art', 'rightWall', 6, 6, 2, 3, 0, '#d6b7ae'),
    pg_temp.wall_item('poster', 'poster', 'leftWall', 6, 3, 2, 3, 0, '#b8c5ac'),
    pg_temp.wall_item('inventory-profile-default', 'profile-board', 'rightWall', 0, 1, 2, 3),
    pg_temp.wall_item('inventory-guestbook-default', 'guestbook', 'rightWall', 8, 4, 1, 1),
    pg_temp.wall_item('inventory-cd-default', 'cd-player', 'rightWall', 9, 4, 1, 1)
  ),
  jsonb_build_object('leftWall', '#f1dfc4', 'rightWall', '#f5e5df', 'floor', 'whitewood#e8ddcf')
),
(
  'byebyeya',
  'Gamer / Tech Room',
  jsonb_build_array(
    pg_temp.floor_item('desk', 'desk', 4, 0, 2, 1, 0, '#292d37'),
    pg_temp.floor_item('chair', 'chair', 4, 2, 1, 1, 3.141592653589793, '#252934'),
    pg_temp.surface_item('inventory-gamer-monitors', 'dual-monitors', 'desk:top', 0, 0, 3, 1, 0, '#6478b8'),
    pg_temp.surface_item('inventory-gamer-speaker', 'speaker', 'desk:top', 3, 1, 1, 1),
    pg_temp.floor_item('inventory-gamer-shelf', 'glass-shelf', 0, 1, 2, 1, 1.5707963267948966, '#313744'),
    pg_temp.surface_item('inventory-gamer-figure', 'plush', 'inventory-gamer-shelf:top', 0, 0, 1, 1, 0, '#7186c7'),
    pg_temp.surface_item('inventory-gamer-cases', 'book-prop', 'inventory-gamer-shelf:top', 2, 0, 1, 1, 0, '#697eb8'),
    pg_temp.floor_item('cabinet', 'cabinet', 0, 5, 2, 1, 1.5707963267948966, '#2c3038'),
    pg_temp.floor_item('inventory-gamer-fridge', 'mini-fridge', 8, 1, 1, 1, 0, '#c9ced6'),
    pg_temp.surface_item('inventory-gamer-projector', 'star-projector', 'inventory-gamer-fridge:top', 0, 0, 1, 1),
    pg_temp.floor_item('inventory-gamer-beanbag', 'beanbag', 8, 6, 1, 1, 0, '#30374b'),
    pg_temp.floor_item('rug', 'rug', 3, 2, 3, 2, 0, '#343948'),
    pg_temp.wall_item('inventory-gamer-led', 'string-lights', 'rightWall', 3, 8, 3, 1, 0, '#738cff'),
    pg_temp.wall_item('inventory-gamer-poster', 'animated-poster', 'rightWall', 7, 5, 2, 3),
    pg_temp.wall_item('inventory-gamer-art', 'wall-art', 'leftWall', 6, 5, 2, 3, 0, '#53659b'),
    pg_temp.wall_item('inventory-profile-default', 'profile-board', 'leftWall', 1, 1, 2, 3),
    pg_temp.wall_item('inventory-guestbook-default', 'guestbook', 'leftWall', 4, 3, 1, 1),
    pg_temp.wall_item('inventory-cd-default', 'cd-player', 'leftWall', 5, 3, 1, 1)
  ),
  jsonb_build_object('leftWall', '#252a36', 'rightWall', '#202532', 'floor', 'tile#303643')
),
(
  'smilely',
  'Fashion / Mirror Room',
  jsonb_build_array(
    pg_temp.floor_item('inventory-fashion-rack', 'hanger', 2, 0, 2, 1, 0, '#e8e2dc'),
    pg_temp.floor_item('cabinet', 'cabinet', 6, 0, 2, 1, 0, '#eee7de'),
    pg_temp.surface_item('inventory-fashion-candle', 'candle', 'cabinet:top', 0, 0, 1, 1),
    pg_temp.surface_item('inventory-fashion-book', 'book-prop', 'cabinet:top', 2, 0, 1, 1, 0, '#222222'),
    pg_temp.floor_item('chair', 'chair', 1, 5, 1, 1, 0, '#d9b6bb'),
    pg_temp.floor_item('inventory-fashion-shoes', 'glass-shelf', 8, 2, 2, 1, 1.5707963267948966, '#d9d8d4'),
    pg_temp.floor_item('inventory-fashion-table', 'side-table', 5, 5, 1, 1, 0, '#d7d3cf'),
    pg_temp.surface_item('inventory-fashion-vase', 'vase', 'inventory-fashion-table:top', 0, 0, 2, 2, 0, '#f0d5dc'),
    pg_temp.floor_item('rug', 'rug', 3, 4, 3, 2, 0, '#eadcdf'),
    pg_temp.floor_item('inventory-fashion-lamp', 'floor-lamp', 8, 7, 1, 1, 0, '#f4f1ed'),
    pg_temp.wall_item('inventory-fashion-mirror', 'full-mirror', 'leftWall', 1, 1, 2, 5),
    pg_temp.wall_item('inventory-fashion-poster', 'wall-art', 'rightWall', 6, 5, 2, 3, 0, '#d7b2bb'),
    pg_temp.wall_item('inventory-fashion-frame', 'photo-frame-2', 'rightWall', 3, 6, 2, 2, 0, '#d6d2ce'),
    pg_temp.wall_item('inventory-profile-default', 'profile-board', 'rightWall', 0, 1, 2, 3),
    pg_temp.wall_item('inventory-guestbook-default', 'guestbook', 'rightWall', 8, 3, 1, 1),
    pg_temp.wall_item('inventory-cd-default', 'cd-player', 'rightWall', 9, 3, 1, 1)
  ),
  jsonb_build_object('leftWall', '#f4f0ea', 'rightWall', '#eedde1', 'floor', 'whitewood#ece7e1')
),
(
  'peterjm007',
  'Y2K Room',
  jsonb_build_array(
    pg_temp.floor_item('bed', 'bed', 4, 0, 2, 3, 0, '#f0b8ce'),
    pg_temp.floor_item('inventory-y2k-table', 'side-table', 3, 1, 1, 1, 0, '#d8e7ec'),
    pg_temp.surface_item('inventory-y2k-star', 'star-projector', 'inventory-y2k-table:top', 0, 0, 1, 1, 0, '#b8a8da'),
    pg_temp.floor_item('inventory-y2k-lamp', 'floor-lamp', 6, 1, 1, 1, 0, '#efc3dc'),
    pg_temp.floor_item('desk', 'desk', 0, 4, 2, 1, 1.5707963267948966, '#e5e8ec'),
    pg_temp.floor_item('chair', 'chair', 2, 4, 1, 1, 1.5707963267948966, '#c4dbee'),
    pg_temp.surface_item('computer', 'computer', 'desk:top', 0, 0, 2, 1),
    pg_temp.surface_item('inventory-y2k-led', 'led-lamp', 'desk:top', 3, 1, 1, 1, 0, '#b9a5dc'),
    pg_temp.floor_item('inventory-y2k-cubes', 'glass-shelf', 8, 3, 2, 1, 1.5707963267948966, '#dbe6ea'),
    pg_temp.surface_item('inventory-y2k-plush', 'plush', 'inventory-y2k-cubes:top', 0, 0, 1, 1, 0, '#f0b6cf'),
    pg_temp.floor_item('inventory-y2k-tv', 'tv', 7, 0, 2, 1, 0, '#d8dce4'),
    pg_temp.floor_item('inventory-y2k-beanbag', 'beanbag', 7, 7, 1, 1, 0, '#c8b6df'),
    pg_temp.floor_item('rug', 'rug', 3, 4, 3, 2, 0, '#e9d5ec'),
    pg_temp.wall_item('inventory-y2k-full-mirror', 'full-mirror', 'leftWall', 1, 1, 2, 5),
    pg_temp.wall_item('inventory-y2k-heart', 'heart-mirror', 'rightWall', 4, 6, 2, 2),
    pg_temp.wall_item('inventory-y2k-poster', 'wall-art', 'rightWall', 7, 4, 2, 3, 0, '#c8b6df'),
    pg_temp.wall_item('inventory-y2k-lights', 'string-lights', 'leftWall', 4, 8, 3, 1, 0, '#c8b8ff'),
    pg_temp.wall_item('inventory-profile-default', 'profile-board', 'rightWall', 0, 1, 2, 3),
    pg_temp.wall_item('inventory-guestbook-default', 'guestbook', 'rightWall', 8, 2, 1, 1),
    pg_temp.wall_item('inventory-cd-default', 'cd-player', 'rightWall', 9, 2, 1, 1)
  ),
  jsonb_build_object('leftWall', '#eadff2', 'rightWall', '#e8f0f7', 'floor', 'whitewood#eee8f3')
);

-- 잘못된 모델 id, 중복 소유, 벽/바닥 경계 초과를 DB 반영 전에 중단한다.
do $$
begin
  if exists (
    select 1
    from theme_room_updates as room,
      lateral jsonb_array_elements(room.items) as item(value)
    group by room.handle, item.value ->> 'id'
    having count(*) > 1
  ) then
    raise exception '한 방 안에 중복된 가구 id가 있습니다.';
  end if;

  if exists (
    select 1
    from theme_room_updates as room,
      lateral jsonb_array_elements(room.items) as item(value)
    group by room.handle, item.value ->> 'type'
    having count(*) > 1
  ) then
    raise exception '한 방 안에 같은 가구 타입이 두 번 배치됐습니다.';
  end if;

  if exists (
    select 1
    from theme_room_updates as room,
      lateral jsonb_array_elements(room.items) as item(value)
    cross join lateral (
      select
        case when item.value ->> 'resolution' = 'subgrid2' then 20 else 10 end as grid_size,
        case
          when abs(round(((item.value -> 'rotation' ->> 1)::double precision) / (pi() / 2)))::integer % 2 = 1
            then (item.value -> 'footprint' ->> 'depth')::integer
          else (item.value -> 'footprint' ->> 'width')::integer
        end as placed_width,
        case
          when abs(round(((item.value -> 'rotation' ->> 1)::double precision) / (pi() / 2)))::integer % 2 = 1
            then (item.value -> 'footprint' ->> 'width')::integer
          else (item.value -> 'footprint' ->> 'depth')::integer
        end as placed_depth
    ) as size
    where item.value ->> 'surfaceId' in ('floor', 'leftWall', 'rightWall')
      and (
        (item.value ->> 'gridX')::integer < 0
        or (item.value ->> 'gridY')::integer < 0
        or (item.value ->> 'gridX')::integer + size.placed_width > size.grid_size
        or (item.value ->> 'gridY')::integer + size.placed_depth > size.grid_size
      )
  ) then
    raise exception '벽 또는 바닥 Grid 경계를 벗어난 가구가 있습니다.';
  end if;

  if exists (
    select 1
    from theme_room_updates as room,
      lateral jsonb_array_elements(room.items) as item(value)
    where position(':' in item.value ->> 'surfaceId') > 0
      and not exists (
        select 1
        from jsonb_array_elements(room.items) as owner(value)
        where owner.value ->> 'id' = split_part(item.value ->> 'surfaceId', ':', 1)
      )
  ) then
    raise exception '상판 소품의 기준 가구가 없습니다.';
  end if;
end $$;

-- 활성 방의 슬롯만 교체한다. smilely의 두 번째 방 등 다른 슬롯은 그대로 남는다.
with source as (
  select
    room.handle,
    room.data,
    update_row.items,
    update_row.style,
    nullif(room.data ->> 'my-room-slots-v1', '')::jsonb as slots
  from public.rooms as room
  join theme_room_updates as update_row using (handle)
), rewritten as (
  select
    handle,
    data,
    jsonb_set(
      slots,
      '{slots}',
      (
        select jsonb_agg(
          case
            when slot.value ->> 'id' = slots ->> 'active'
              then slot.value || jsonb_build_object('items', items, 'style', style)
            else slot.value
          end
          order by slot.ordinality
        )
        from jsonb_array_elements(slots -> 'slots') with ordinality as slot(value, ordinality)
      ),
      false
    ) as next_slots
  from source
)
update public.rooms as room
set
  data = jsonb_set(room.data, '{my-room-slots-v1}', to_jsonb(rewritten.next_slots::text), true),
  updated_at = now()
from rewritten
where room.handle = rewritten.handle;

-- 적용 결과: 대상, 콘셉트, 활성 방의 실제 배치 수를 확인한다.
select
  room.handle,
  update_row.concept,
  active_slot.value ->> 'name' as room_name,
  jsonb_array_length(active_slot.value -> 'items') as placed_items
from public.rooms as room
join theme_room_updates as update_row using (handle)
cross join lateral jsonb_array_elements((room.data ->> 'my-room-slots-v1')::jsonb -> 'slots') as active_slot(value)
where active_slot.value ->> 'id' = (room.data ->> 'my-room-slots-v1')::jsonb ->> 'active'
order by room.handle;

commit;
