-- Canal de Integridade v0.6
-- Persistencia administrativa segura e auditoria automatica de configuracoes.

create or replace function app_private.audit_admin_config_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_row jsonb;
  after_row jsonb;
  organization_uuid uuid;
  object_key text;
begin
  if tg_op = 'INSERT' then
    before_row := null;
    after_row := to_jsonb(new) - 'created_at' - 'updated_at';
  elsif tg_op = 'DELETE' then
    before_row := to_jsonb(old) - 'created_at' - 'updated_at';
    after_row := null;
  else
    before_row := to_jsonb(old) - 'created_at' - 'updated_at';
    after_row := to_jsonb(new) - 'created_at' - 'updated_at';
    if before_row = after_row then
      return new;
    end if;
  end if;

  organization_uuid := coalesce(
    nullif(after_row ->> 'organization_id', '')::uuid,
    nullif(before_row ->> 'organization_id', '')::uuid,
    nullif(after_row ->> 'id', '')::uuid,
    nullif(before_row ->> 'id', '')::uuid
  );

  object_key := coalesce(
    after_row ->> 'id',
    before_row ->> 'id',
    after_row ->> 'organization_id',
    before_row ->> 'organization_id'
  );

  if organization_uuid is null then
    raise exception 'Nao foi possivel determinar a organizacao para auditoria';
  end if;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    action,
    object_type,
    object_id,
    metadata
  ) values (
    organization_uuid,
    (select auth.uid()),
    'admin.config.' || tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    object_key,
    jsonb_build_object('before', before_row, 'after', after_row)
  );

  return coalesce(new, old);
end;
$$;

revoke all on function app_private.audit_admin_config_change() from public, anon, authenticated;
grant execute on function app_private.audit_admin_config_change() to service_role;

drop trigger if exists audit_organization_config on public.organizations;
create trigger audit_organization_config
after update on public.organizations
for each row execute function app_private.audit_admin_config_change();

drop trigger if exists audit_site_settings_config on public.site_settings;
create trigger audit_site_settings_config
after update on public.site_settings
for each row execute function app_private.audit_admin_config_change();

drop trigger if exists audit_report_categories_config on public.report_categories;
create trigger audit_report_categories_config
after insert or update or delete on public.report_categories
for each row execute function app_private.audit_admin_config_change();

drop trigger if exists audit_sla_policies_config on public.sla_policies;
create trigger audit_sla_policies_config
after insert or update or delete on public.sla_policies
for each row execute function app_private.audit_admin_config_change();

create or replace function public.admin_update_general_settings(
  p_organization_name text,
  p_public_name text,
  p_welcome_text text,
  p_allow_anonymous boolean,
  p_allow_optional_email boolean,
  p_allow_attachments boolean,
  p_default_timezone text,
  p_privacy_notice_version text
)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  organization_uuid uuid;
  normalized_org_name text := btrim(coalesce(p_organization_name, ''));
  normalized_public_name text := btrim(coalesce(p_public_name, ''));
  normalized_welcome text := nullif(btrim(coalesce(p_welcome_text, '')), '');
  normalized_privacy_version text := nullif(btrim(coalesce(p_privacy_notice_version, '')), '');
begin
  if (select auth.uid()) is null
    or not app_private.is_aal2()
    or not app_private.has_staff_role('platform_admin') then
    raise exception 'Acesso administrativo AAL2 obrigatorio';
  end if;

  organization_uuid := app_private.current_org_id();
  if organization_uuid is null then
    raise exception 'Organizacao administrativa nao encontrada';
  end if;

  if char_length(normalized_org_name) not between 2 and 120 then
    raise exception 'Nome da organizacao invalido';
  end if;

  if char_length(normalized_public_name) not between 2 and 120 then
    raise exception 'Nome publico do canal invalido';
  end if;

  if normalized_welcome is not null and char_length(normalized_welcome) > 2000 then
    raise exception 'Mensagem de acolhimento excede o limite';
  end if;

  if normalized_privacy_version is not null and char_length(normalized_privacy_version) > 50 then
    raise exception 'Versao do aviso de privacidade excede o limite';
  end if;

  if not exists (select 1 from pg_timezone_names where name = p_default_timezone) then
    raise exception 'Fuso horario invalido';
  end if;

  update public.organizations
     set name = normalized_org_name
   where id = organization_uuid
     and name is distinct from normalized_org_name;

  update public.site_settings
     set public_name = normalized_public_name,
         welcome_text = normalized_welcome,
         allow_anonymous = p_allow_anonymous,
         allow_optional_email = p_allow_optional_email,
         allow_attachments = p_allow_attachments,
         default_timezone = p_default_timezone,
         privacy_notice_version = normalized_privacy_version,
         updated_at = now()
   where organization_id = organization_uuid
     and (
       public_name,
       welcome_text,
       allow_anonymous,
       allow_optional_email,
       allow_attachments,
       default_timezone,
       privacy_notice_version
     ) is distinct from (
       normalized_public_name,
       normalized_welcome,
       p_allow_anonymous,
       p_allow_optional_email,
       p_allow_attachments,
       p_default_timezone,
       normalized_privacy_version
     );
end;
$$;

revoke all on function public.admin_update_general_settings(text, text, text, boolean, boolean, boolean, text, text) from public, anon;
grant execute on function public.admin_update_general_settings(text, text, text, boolean, boolean, boolean, text, text) to authenticated;
