-- Run once in the Supabase SQL Editor for project pxjavljsalibpnxdrxel.
-- This removes only the abandoned `gyuho` room and rows that point to it.
begin;

delete from public.visits where room = 'gyuho';
delete from public.guestbook where room = 'gyuho';
delete from public.likes where room = 'gyuho';
delete from public.rooms where handle = 'gyuho';

commit;
