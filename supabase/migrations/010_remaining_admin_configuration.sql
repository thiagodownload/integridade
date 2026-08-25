-- Canal de Integridade v0.10
-- Configuracoes reais de notificacoes, e-mail e privacidade.

create table if not exists public.email_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  sender_name text not null default 'Canal de Integridade',
  sender_email text,
  reply_to_email text,
  subject_prefix text not null default '[Canal de Integridade]',
  updated_at timestamptz not null default now()
);

create table if not exists public.privacy_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  report_retention_days integer,
  audit_retention_days integer,
  attachment_retention_days integer,
  anonymize_closed_after_days integer,
  retention_policy_version text,
  legal_review_reference text,
  updated_at timestamptz not null default now(),
  constraint privacy_report_retention_positive check (report_retention_days is null or report_retention_days between 1 and 36500),
  constraint privacy_audit_retention_positive check (audit_retention_days is null or audit_retention_days between 1 and 36500),
  constraint privacy_attachment_retention_positive check (attachment_retention_days is null or attachment_retention_days between 1 and 36500),
  constraint privacy_anonymization_positive check (anonymize_closed_after_days is null or anonymize_closed_after_days between 1 and 36500)
);

insert into public.email_settings (organization_id)
select o.id from public.organizations o
on conflict (organization_id) do nothing;

insert into public.privacy_settings (organization_id)
select o.id from public.organizations o
on conflict (organization_id) do nothing;

alter table public.email_settings enable row level security;
alter table public.privacy_settings enable row level security;

drop policy if exists "platform admin reads email settings" on public.email_settings;
create policy "platform admin reads email settings"
on public.email_settings for select to authenticated
using (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
);

drop policy if exists "platform admin updates email settings" on public.email_settings;
create policy "platform admin updates email settings"
on public.email_settings for update to authenticated
using (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
)
with check (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
);

drop policy if exists "platform admin reads privacy settings" on public.privacy_settings;
create policy "platform admin reads privacy settings"
on public.privacy_settings for select to authenticated
using (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
);

drop policy if exists "platform admin updates privacy settings" on public.privacy_settings;
create policy "platform admin updates privacy settings"
on public.privacy_settings for update to authenticated
using (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
)
with check (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
);

grant select, update on public.email_settings to authenticated;
grant select, update on public.privacy_settings to authenticated;

-- Auditoria automatica.
drop trigger if exists audit_email_settings_config on public.email_settings;
create trigger audit_email_settings_config
after update on public.email_settings
for each row execute function app_private.audit_admin_config_change();

drop trigger if exists audit_privacy_settings_config on public.privacy_settings;
create trigger audit_privacy_settings_config
after update on public.privacy_settings
for each row execute function app_private.audit_admin_config_change();

drop trigger if exists audit_notification_rules_config on public.notification_rules;
create trigger audit_notification_rules_config
after insert or update or delete on public.notification_rules
for each row execute function app_private.audit_admin_config_change();

create unique index if not exists notification_rules_unique_config_idx
  on public.notification_rules (
    organization_id,
    event_type,
    channel,
    coalesce(destination_role::text, '')
  );

create or replace function public.admin_save_notification_rules(p_rules jsonb)
returns void
language plpgsql
security invoker
set search_path = public, app_private, pg_temp
as $$
declare
  organization_uuid uuid := app_private.current_org_id();
  row_data jsonb;
  normalized_event text;
  normalized_channel text;
  normalized_role public.staff_role;
begin
  if (select auth.uid()) is null
     or not app_private.is_aal2()
     or not app_private.has_staff_role('platform_admin') then
    raise exception 'Acesso administrativo AAL2 obrigatorio';
  end if;

  if organization_uuid is null then
    raise exception 'Organizacao administrativa nao encontrada';
  end if;

  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) > 100 then
    raise exception 'Configuracao de notificacoes invalida';
  end if;

  delete from public.notification_rules
   where organization_id = organization_uuid;

  for row_data in select value from jsonb_array_elements(p_rules)
  loop
    normalized_event := btrim(coalesce(row_data ->> 'event_type', ''));
    normalized_channel := btrim(coalesce(row_data ->> 'channel', ''));

    if normalized_event not in (
      'report.created',
      'report.restricted.created',
      'sla.warning_70',
      'sla.warning_90',
      'sla.expired',
      'report.message.created'
    ) then
      raise exception 'Tipo de evento invalido';
    end if;

    if normalized_channel not in ('in_app', 'email', 'browser') then
      raise exception 'Canal de notificacao invalido';
    end if;

    begin
      normalized_role := (row_data ->> 'destination_role')::public.staff_role;
    exception when others then
      raise exception 'Papel de destino invalido';
    end;

    insert into public.notification_rules (
      organization_id,
      event_type,
      channel,
      destination_role,
      enabled
    ) values (
      organization_uuid,
      normalized_event,
      normalized_channel,
      normalized_role,
      coalesce((row_data ->> 'enabled')::boolean, true)
    )
    on conflict do nothing;
  end loop;
end;
$$;

revoke all on function public.admin_save_notification_rules(jsonb) from public, anon;
grant execute on function public.admin_save_notification_rules(jsonb) to authenticated;

create or replace function public.admin_update_email_settings(
  p_sender_name text,
  p_sender_email text,
  p_reply_to_email text,
  p_subject_prefix text
)
returns void
language plpgsql
security invoker
set search_path = public, app_private, pg_temp
as $$
declare
  organization_uuid uuid := app_private.current_org_id();
  sender_name_value text := btrim(coalesce(p_sender_name, ''));
  sender_email_value text := nullif(lower(btrim(coalesce(p_sender_email, ''))), '');
  reply_to_value text := nullif(lower(btrim(coalesce(p_reply_to_email, ''))), '');
  prefix_value text := btrim(coalesce(p_subject_prefix, ''));
begin
  if (select auth.uid()) is null
     or not app_private.is_aal2()
     or not app_private.has_staff_role('platform_admin') then
    raise exception 'Acesso administrativo AAL2 obrigatorio';
  end if;

  if organization_uuid is null then
    raise exception 'Organizacao administrativa nao encontrada';
  end if;

  if char_length(sender_name_value) not between 2 and 120 then
    raise exception 'Nome do remetente invalido';
  end if;

  if sender_email_value is not null and (
    char_length(sender_email_value) > 320
    or sender_email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
  ) then
    raise exception 'E-mail do remetente invalido';
  end if;

  if reply_to_value is not null and (
    char_length(reply_to_value) > 320
    or reply_to_value !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
  ) then
    raise exception 'Reply-to invalido';
  end if;

  if char_length(prefix_value) > 80 then
    raise exception 'Prefixo de assunto excede o limite';
  end if;

  update public.email_settings
     set sender_name = sender_name_value,
         sender_email = sender_email_value,
         reply_to_email = reply_to_value,
         subject_prefix = prefix_value,
         updated_at = now()
   where organization_id = organization_uuid;
end;
$$;

revoke all on function public.admin_update_email_settings(text,text,text,text) from public, anon;
grant execute on function public.admin_update_email_settings(text,text,text,text) to authenticated;

create or replace function public.admin_update_privacy_settings(
  p_report_retention_days integer,
  p_audit_retention_days integer,
  p_attachment_retention_days integer,
  p_anonymize_closed_after_days integer,
  p_retention_policy_version text,
  p_legal_review_reference text
)
returns void
language plpgsql
security invoker
set search_path = public, app_private, pg_temp
as $$
declare
  organization_uuid uuid := app_private.current_org_id();
  version_value text := nullif(btrim(coalesce(p_retention_policy_version, '')), '');
  legal_reference_value text := nullif(btrim(coalesce(p_legal_review_reference, '')), '');
begin
  if (select auth.uid()) is null
     or not app_private.is_aal2()
     or not app_private.has_staff_role('platform_admin') then
    raise exception 'Acesso administrativo AAL2 obrigatorio';
  end if;

  if organization_uuid is null then
    raise exception 'Organizacao administrativa nao encontrada';
  end if;

  if p_report_retention_days is not null and p_report_retention_days not between 1 and 36500 then raise exception 'Retencao de relatos invalida'; end if;
  if p_audit_retention_days is not null and p_audit_retention_days not between 1 and 36500 then raise exception 'Retencao de auditoria invalida'; end if;
  if p_attachment_retention_days is not null and p_attachment_retention_days not between 1 and 36500 then raise exception 'Retencao de anexos invalida'; end if;
  if p_anonymize_closed_after_days is not null and p_anonymize_closed_after_days not between 1 and 36500 then raise exception 'Prazo de anonimizacao invalido'; end if;

  if version_value is not null and char_length(version_value) > 50 then raise exception 'Versao da politica excede o limite'; end if;
  if legal_reference_value is not null and char_length(legal_reference_value) > 240 then raise exception 'Referencia juridica excede o limite'; end if;

  update public.privacy_settings
     set report_retention_days = p_report_retention_days,
         audit_retention_days = p_audit_retention_days,
         attachment_retention_days = p_attachment_retention_days,
         anonymize_closed_after_days = p_anonymize_closed_after_days,
         retention_policy_version = version_value,
         legal_review_reference = legal_reference_value,
         updated_at = now()
   where organization_id = organization_uuid;
end;
$$;

revoke all on function public.admin_update_privacy_settings(integer,integer,integer,integer,text,text) from public, anon;
grant execute on function public.admin_update_privacy_settings(integer,integer,integer,integer,text,text) to authenticated;
