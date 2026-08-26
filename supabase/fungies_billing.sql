-- Fungies payment_success 웹훅을 주문당 정확히 한 번만 크레딧으로 전환한다.
-- Fungies 설정 전에 Supabase SQL Editor에서 이 파일 전체를 실행한다.

create table if not exists public.fungies_payment_events (
  event_id text primary key,
  handle text not null,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now()
);

alter table public.fungies_payment_events enable row level security;
revoke all on table public.fungies_payment_events from anon, authenticated;

create or replace function public.fulfill_fungies_payment(
  p_event_id text,
  p_handle text,
  p_amount integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_event_id, '') = ''
     or p_handle !~ '^[A-Za-z0-9_-]{1,64}$'
     or p_amount < 1 then
    raise exception 'invalid Fungies payment';
  end if;

  insert into public.fungies_payment_events (event_id, handle, amount)
  values (p_event_id, p_handle, p_amount)
  on conflict (event_id) do nothing;

  if not found then
    return false;
  end if;

  perform public.add_credits(p_handle, p_amount);
  return true;
end;
$$;

revoke all on function public.fulfill_fungies_payment(text, text, integer) from public, anon, authenticated;
grant execute on function public.fulfill_fungies_payment(text, text, integer) to service_role;
