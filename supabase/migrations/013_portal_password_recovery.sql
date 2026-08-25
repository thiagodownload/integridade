-- Canal de Integridade v0.13
-- Rate limit privado para recuperação de senha enviada pelo SMTP do portal.

create table if not exists private.password_recovery_limits (
  email_digest text primary key,
  requested_at timestamptz not null default now()
);

revoke all on table private.password_recovery_limits from public, anon, authenticated;

create or replace function public.claim_password_recovery_internal(
  p_email_digest text,
  p_window_minutes integer default 5
)
returns boolean
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  previous_at timestamptz;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Somente service_role';
  end if;

  if p_email_digest is null or char_length(p_email_digest) < 32 then
    raise exception 'Digest invalido';
  end if;

  if p_window_minutes not between 1 and 1440 then
    raise exception 'Janela invalida';
  end if;

  select requested_at into previous_at
  from private.password_recovery_limits
  where email_digest = p_email_digest
  for update;

  if previous_at is not null
     and previous_at > now() - make_interval(mins => p_window_minutes) then
    return false;
  end if;

  insert into private.password_recovery_limits(email_digest, requested_at)
  values (p_email_digest, now())
  on conflict (email_digest) do update set requested_at = excluded.requested_at;

  return true;
end;
$$;

revoke all on function public.claim_password_recovery_internal(text,integer) from public, anon, authenticated;
grant execute on function public.claim_password_recovery_internal(text,integer) to service_role;
