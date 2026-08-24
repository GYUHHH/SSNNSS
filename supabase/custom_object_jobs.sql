-- AI 커스텀 오브젝트 비동기 생성 작업 큐.
-- Supabase SQL Editor에서 이 파일 전체를 한 번 실행해야 한다.

create table if not exists public.custom_object_jobs (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('furniture', 'wallDecoration', 'floor', 'sculpture')),
  prompt text not null default '',
  reference_path text not null,
  reference_mime text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'consumed')),
  stage text not null default 'queued',
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.custom_object_jobs enable row level security;
revoke all on table public.custom_object_jobs from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'custom-object-inputs',
  'custom-object-inputs',
  false,
  7000000,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
