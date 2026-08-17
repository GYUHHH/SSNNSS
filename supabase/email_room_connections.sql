-- Run in the Supabase SQL Editor. Read-only: shows every room and its owner email.
select
  u.email as owner_email,
  r.handle as room_handle,
  r.owner as owner_id
from public.rooms as r
left join auth.users as u on u.id = r.owner
order by u.email nulls last, r.handle;
