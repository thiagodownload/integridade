-- Canal de Integridade v0.21
-- Segredos criptográficos no Vault + rate limit pseudonimizado para o gateway público.

create table if not exists private.public_crypto_secret_refs (
  singleton boolean primary key default true check (singleton),
  protocol_pepper_secret_id uuid not null,
  contact_encryption_secret_id uuid not null,
  created_at timestamptz not null default now()
);

revoke all on table private.public_crypto_secret_refs from public, anon, authenticated;

do $$
declare
  v_protocol_secret_id uuid;
  v_contact_secret_id uuid;
  v_protocol_pepper text;
  v_contact_key text;
begin
  if not exists (select 1 from private.public_crypto_secret_refs where singleton) then
    v_protocol_pepper := translate(rtrim(encode(gen_random_bytes(32), 'base64'), '='), '+/', '-_');
    v_contact_key := translate(rtrim(encode(gen_random_bytes(32), 'base64'), '='), '+/', '-_');

    select vault.create_secret(
      v_protocol_pepper,
      'integridade_protocol_pepper',
      'HMAC pepper para protocolos públicos do Canal de Integridade',
      null
    ) into v_protocol_secret_id;

    select vault.create_secret(
      v_contact_key,
      'integridade_contact_encryption_key',
      'AES-256-GCM key para contato opcional do denunciante',
      null
    ) into v_contact_secret_id;

    insert into private.public_crypto_secret_refs(
      singleton,
      protocol_pepper_secret_id,
      contact_encryption_secret_id
    ) values (true, v_protocol_secret_id, v_contact_secret_id);
  end if;
end $$;

create or replace function public.get_public_crypto_material_internal()
returns table (
  protocol_pepper text,
  contact_encryption_key text
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
    protocol_secret.decrypted_secret,
    contact_secret.decrypted_secret
  from private.public_crypto_secret_refs refs
  join vault.decrypted_secrets protocol_secret
    on protocol_secret.id = refs.protocol_pepper_secret_id
  join vault.decrypted_secrets contact_secret
    on contact_secret.id = refs.contact_encryption_secret_id
  where refs.singleton;
end;
$$;

revoke all on function public.get_public_crypto_material_internal() from public, anon, authenticated;
grant execute on function public.get_public_crypto_material_internal() to service_role;

create table if not exists private.public_rate_limits (
  identity_digest text not null,
  action text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (identity_digest, action),
  check (char_length(identity_digest) between 32 and 128),
  check (char_length(action) between 2 and 64)
);

revoke all on table private.public_rate_limits from public, anon, authenticated;

create or replace function public.claim_public_rate_limit_internal(
  p_identity_digest text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_row private.public_rate_limits%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Somente service_role';
  end if;

  if p_identity_digest is null or char_length(p_identity_digest) not between 32 and 128 then
    raise exception 'Digest invalido';
  end if;
  if p_action is null or char_length(p_action) not between 2 and 64 then
    raise exception 'Acao invalida';
  end if;
  if p_limit not between 1 and 1000 then
    raise exception 'Limite invalido';
  end if;
  if p_window_seconds not between 10 and 86400 then
    raise exception 'Janela invalida';
  end if;

  select * into v_row
  from private.public_rate_limits
  where identity_digest = p_identity_digest
    and action = p_action
  for update;

  if not found then
    insert into private.public_rate_limits(identity_digest, action, request_count)
    values (p_identity_digest, p_action, 1);
    return true;
  end if;

  if v_row.window_started_at <= now() - make_interval(secs => p_window_seconds) then
    update private.public_rate_limits
       set window_started_at = now(),
           request_count = 1,
           updated_at = now()
     where identity_digest = p_identity_digest
       and action = p_action;
    return true;
  end if;

  if v_row.request_count >= p_limit then
    return false;
  end if;

  update private.public_rate_limits
     set request_count = request_count + 1,
         updated_at = now()
   where identity_digest = p_identity_digest
     and action = p_action;

  return true;
end;
$$;

revoke all on function public.claim_public_rate_limit_internal(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.claim_public_rate_limit_internal(text,text,integer,integer) to service_role;

create or replace function public.get_public_form_config_internal()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Somente service_role';
  end if;

  select jsonb_build_object(
    'organizationSlug', o.slug,
    'publicName', s.public_name,
    'welcomeText', s.welcome_text,
    'allowAnonymous', s.allow_anonymous,
    'allowOptionalEmail', s.allow_optional_email,
    'allowAttachments', false,
    'privacyNoticeVersion', s.privacy_notice_version,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'description', c.description
      ) order by c.name)
      from public.report_categories c
      where c.organization_id = o.id
        and c.active
    ), '[]'::jsonb)
  ) into v_result
  from public.organizations o
  join public.site_settings s on s.organization_id = o.id
  order by o.created_at
  limit 1;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.get_public_form_config_internal() from public, anon, authenticated;
grant execute on function public.get_public_form_config_internal() to service_role;
