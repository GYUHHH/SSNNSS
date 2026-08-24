update public.custom_object_jobs
set
  status = 'failed',
  stage = 'failed',
  error = 'PIPELINE_CANCELLED',
  updated_at = now()
where owner_id = (
  select id
  from auth.users
  where lower(email) = lower('gyuhyun0104@gmail.com')
  limit 1
)
and status in ('queued', 'running');
