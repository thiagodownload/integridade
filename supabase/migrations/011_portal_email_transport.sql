-- Canal de Integridade v0.11
-- Transporte SMTP central do portal com senha protegida no Supabase Vault.

alter table public.email_settings
  add column if not exists transport_enabled boolean not null default false,
  add column if not exists smtp_host text,
  add column if not exists smtp_port integer not null default 587,
  add column if not exists smtp_secure boolean not null default false,
  add column if not exists smtp_require_tls boolean not null default true,
  add column if not exists smtp_username text,
  add column if not exists smtp_password_configured boolean not null default false,
  add column if not exists last_test_at timestamptz,
  add column if not exists last_test_ok boolean,
  add column if not exists last_test_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'email_settings_smtp_port_valid'
      and conrelid = 'public.email_settings'::regclass
  ) then
    alter table public.email_settings
      add constraint email_settings_smtp_port_valid
      check (smtp_port between 1 and 65535);
  end if;
end $$;

create table if not exists private.email_secret_refs (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  smtp_password_secret_id uuid not null,
  updated_at timestamptz not null default now()
);

revoke all on table private.email_secret_refs from public, anon, authenticated;

-- E-mail passa a ser alterado exclusivamente pela Edge Function administrativa,
-- porque a senha precisa atravessar apenas backend -> Vault.
revoke execute on function public.admin_update_email_settings(text,text,text,text) from authenticated;

drop trigger if exists audit_email_settings_config on public.email_settings;

create or replace function public.admin_save_email_transport_internal(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_sender_name text,
  p_sender_email text,
  p_reply_to_email text,
  p_subject_prefix text,
  p_transport_enabled boolean,
  p_smtp_host text,
  p_smtp_port integer,
  p_smtp_secure boolean,
  p_smtp_require_tls boolean,
  p_smtp_username text,
  p_smtp_password text
)
returns void
language plpgsql
security definer
set search_path = public, private, vault, pg_temp
as $$
declare
  sender_name_value text := btrim(coalesce(p_sender_name, ''));
  sender_email_value text := lower(btrim(coalesce(p_sender_email, '')));
  reply_to_value text := nullif(lower(btrim(coalesce(p_reply_to_email, ''))), '');
  prefix_value text := btrim(coalesce(p_subject_prefix, ''));
  host_value text := lower(btrim(coalesce(p_smtp_host, '')));
  username_value text := nullif(btrim(coalesce(p_smtp_username, '')), '');
  password_value text := nullif(p_smtp_password, '');
  secret_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Somente service_role';
  end if;

  if not exists (
    select 1
    from public.staff_profiles p
    join public.staff_roles r on r.user_id = p.user_id
    where p.user_id = p_actor_user_id
      and p.organization_id = p_organization_id
      and p.active
      and r.role = 'platform_admin'
  ) then
    raise exception 'Administrador solicitante invalido';
  end if;

  if char_length(sender_name_value) not between 2 and 120 then
    raise exception 'Nome do remetente invalido';
  end if;

  if sender_email_value = '' or char_length(sender_email_value) > 320
     or sender_email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'E-mail do remetente invalido';
  end if;

  if reply_to_value is not null and (
    char_length(reply_to_value) > 320
    or reply_to_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'Reply-to invalido';
  end if;

  if char_length(prefix_value) > 80 then
    raise exception 'Prefixo de assunto excede o limite';
  end if;

  if p_smtp_port not between 1 and 65535 then
    raise exception 'Porta SMTP invalida';
  end if;

  if p_transport_enabled and (host_value = '' or username_value is null) then
    raise exception 'Host e usuario SMTP sao obrigatorios para habilitar o transporte';
  end if;

  select smtp_password_secret_id
    into secret_id
  from private.email_secret_refs
  where organization_id = p_organization_id;

  if password_value is not null then
    if secret_id is null then
      select vault.create_secret(
        password_value,
        'integridade_smtp_' || p_organization_id::text,
        'Senha SMTP do Canal de Integridade',
        null
      ) into secret_id;

      insert into private.email_secret_refs(organization_id, smtp_password_secret_id)
      values (p_organization_id, secret_id)
      on conflict (organization_id) do update
        set smtp_password_secret_id = excluded.smtp_password_secret_id,
            updated_at = now();
    else
      perform vault.update_secret(
        secret_id,
        password_value,
        'integridade_smtp_' || p_organization_id::text,
        'Senha SMTP do Canal de Integridade',
        null
      );

      update private.email_secret_refs
         set updated_at = now()
       where organization_id = p_organization_id;
    end if;
  end if;

  if p_transport_enabled and secret_id is null then
    raise exception 'Senha SMTP ainda nao configurada';
  end if;

  update public.email_settings
     set sender_name = sender_name_value,
         sender_email = sender_email_value,
         reply_to_email = reply_to_value,
         subject_prefix = prefix_value,
         transport_enabled = p_transport_enabled,
         smtp_host = nullif(host_value, ''),
         smtp_port = p_smtp_port,
         smtp_secure = p_smtp_secure,
         smtp_require_tls = p_smtp_require_tls,
         smtp_username = username_value,
         smtp_password_configured = (secret_id is not null),
         updated_at = now()
   where organization_id = p_organization_id;

  insert into public.audit_events(
    organization_id, actor_user_id, action, object_type, object_id, metadata
  ) values (
    p_organization_id,
    p_actor_user_id,
    'email.transport.updated',
    'email_settings',
    p_organization_id::text,
    jsonb_build_object(
      'transport_enabled', p_transport_enabled,
      'smtp_host', nullif(host_value, ''),
      'smtp_port', p_smtp_port,
      'smtp_secure', p_smtp_secure,
      'smtp_require_tls', p_smtp_require_tls,
      'smtp_username_configured', username_value is not null,
      'smtp_password_configured', secret_id is not null,
      'sender_email', sender_email_value
    )
  );
end;
$$;

revoke all on function public.admin_save_email_transport_internal(uuid,uuid,text,text,text,text,boolean,text,integer,boolean,boolean,text,text) from public, anon, authenticated;
grant execute on function public.admin_save_email_transport_internal(uuid,uuid,text,text,text,text,boolean,text,integer,boolean,boolean,text,text) to service_role;

create or replace function public.get_email_transport_internal(p_organization_id uuid)
returns table (
  sender_name text,
  sender_email text,
  reply_to_email text,
  subject_prefix text,
  transport_enabled boolean,
  smtp_host text,
  smtp_port integer,
  smtp_secure boolean,
  smtp_require_tls boolean,
  smtp_username text,
  smtp_password text
)
language plpgsql
security definer
set search_path = public, private, vault, pg_temp
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Somente service_role';
  end if;

  return query
  select
    e.sender_name,
    e.sender_email,
    e.reply_to_email,
    e.subject_prefix,
    e.transport_enabled,
    e.smtp_host,
    e.smtp_port,
    e.smtp_secure,
    e.smtp_require_tls,
    e.smtp_username,
    d.decrypted_secret
  from public.email_settings e
  left join private.email_secret_refs r
    on r.organization_id = e.organization_id
  left join vault.decrypted_secrets d
    on d.id = r.smtp_password_secret_id
  where e.organization_id = p_organization_id;
end;
$$;

revoke all on function public.get_email_transport_internal(uuid) from public, anon, authenticated;
grant execute on function public.get_email_transport_internal(uuid) to service_role;

create or replace function public.record_email_test_internal(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_ok boolean,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Somente service_role';
  end if;

  update public.email_settings
     set last_test_at = now(),
         last_test_ok = p_ok,
         last_test_error = case when p_ok then null else left(coalesce(p_error, 'Falha SMTP'), 500) end,
         updated_at = now()
   where organization_id = p_organization_id;

  insert into public.audit_events(
    organization_id, actor_user_id, action, object_type, object_id, metadata
  ) values (
    p_organization_id,
    p_actor_user_id,
    case when p_ok then 'email.transport.test_succeeded' else 'email.transport.test_failed' end,
    'email_settings',
    p_organization_id::text,
    jsonb_build_object('ok', p_ok)
  );
end;
$$;

revoke all on function public.record_email_test_internal(uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.record_email_test_internal(uuid,uuid,boolean,text) to service_role;
