-- Canal de Integridade v0.4
-- Criação atômica de relatos e lookup interno por digest.

create or replace function public.create_report_internal(
  p_organization_slug text,
  p_category_id uuid,
  p_relationship text,
  p_location_text text,
  p_occurred_on date,
  p_ongoing boolean,
  p_description text,
  p_people_involved text,
  p_protocol_digest text,
  p_email_ciphertext text,
  p_email_nonce text,
  p_email_enabled boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_allow_anonymous boolean;
  v_allow_optional_email boolean;
  v_priority public.report_priority := 'medium';
  v_restricted boolean := false;
  v_report_id uuid;
begin
  select o.id, s.allow_anonymous, s.allow_optional_email
    into v_org_id, v_allow_anonymous, v_allow_optional_email
  from public.organizations o
  join public.site_settings s on s.organization_id = o.id
  where o.slug = p_organization_slug;

  if v_org_id is null then
    raise exception 'organization_not_found';
  end if;

  if not v_allow_anonymous then
    raise exception 'anonymous_reporting_disabled';
  end if;

  if p_email_enabled and not v_allow_optional_email then
    raise exception 'optional_email_disabled';
  end if;

  if p_category_id is not null then
    select c.severity_default, c.restricted_by_default
      into v_priority, v_restricted
    from public.report_categories c
    where c.id = p_category_id
      and c.organization_id = v_org_id
      and c.active = true;

    if not found then
      raise exception 'invalid_category';
    end if;
  end if;

  insert into public.reports (
    organization_id,
    category_id,
    status,
    priority,
    restricted,
    relationship,
    location_text,
    occurred_on,
    ongoing,
    description,
    people_involved
  ) values (
    v_org_id,
    p_category_id,
    'new',
    v_priority,
    v_restricted,
    p_relationship,
    p_location_text,
    p_occurred_on,
    p_ongoing,
    p_description,
    p_people_involved
  )
  returning id into v_report_id;

  insert into public.report_protocols (report_id, protocol_digest)
  values (v_report_id, p_protocol_digest);

  if p_email_enabled then
    if p_email_ciphertext is null or p_email_nonce is null then
      raise exception 'invalid_encrypted_contact';
    end if;

    insert into public.report_contacts (
      report_id,
      email_ciphertext,
      email_nonce,
      email_enabled
    ) values (
      v_report_id,
      p_email_ciphertext,
      p_email_nonce,
      true
    );
  end if;

  insert into public.report_events (
    report_id,
    event_type,
    public_summary
  ) values (
    v_report_id,
    'report_received',
    'Relato recebido e encaminhado para triagem.'
  );

  insert into public.notification_outbox (
    organization_id,
    report_id,
    event_type,
    channel,
    payload
  ) values (
    v_org_id,
    v_report_id,
    'report_created',
    'in_app',
    jsonb_build_object('generic', true)
  );

  return v_report_id;
end;
$$;

create or replace function public.lookup_report_id_internal(p_protocol_digest text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select report_id
  from public.report_protocols
  where protocol_digest = p_protocol_digest
  limit 1
$$;

revoke all on function public.create_report_internal(text, uuid, text, text, date, boolean, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.lookup_report_id_internal(text) from public, anon, authenticated;
grant execute on function public.create_report_internal(text, uuid, text, text, date, boolean, text, text, text, text, text, boolean) to service_role;
grant execute on function public.lookup_report_id_internal(text) to service_role;
