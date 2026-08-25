-- Canal de Integridade v0.7
-- Salvamento atomico das configuracoes de categorias e SLA.

create or replace function public.admin_save_categories(p_categories jsonb)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  organization_uuid uuid;
  item jsonb;
  category_uuid uuid;
  category_name text;
  category_description text;
  category_active boolean;
  category_priority public.report_priority;
  category_restricted boolean;
begin
  if (select auth.uid()) is null
    or not app_private.is_aal2()
    or not app_private.has_staff_role('platform_admin') then
    raise exception 'Acesso administrativo AAL2 obrigatorio';
  end if;

  if jsonb_typeof(p_categories) <> 'array' then
    raise exception 'Lista de categorias invalida';
  end if;

  organization_uuid := app_private.current_org_id();
  if organization_uuid is null then
    raise exception 'Organizacao administrativa nao encontrada';
  end if;

  for item in select value from jsonb_array_elements(p_categories)
  loop
    category_uuid := nullif(item ->> 'id', '')::uuid;
    category_name := btrim(coalesce(item ->> 'name', ''));
    category_description := nullif(btrim(coalesce(item ->> 'description', '')), '');
    category_active := coalesce((item ->> 'active')::boolean, true);
    category_restricted := coalesce((item ->> 'restricted_by_default')::boolean, false);

    begin
      category_priority := coalesce(nullif(item ->> 'severity_default', '')::public.report_priority, 'medium'::public.report_priority);
    exception when invalid_text_representation then
      raise exception 'Prioridade de categoria invalida';
    end;

    if char_length(category_name) not between 2 and 160 then
      raise exception 'Nome de categoria invalido';
    end if;

    if category_description is not null and char_length(category_description) > 1200 then
      raise exception 'Descricao de categoria excede o limite';
    end if;

    if category_uuid is null then
      insert into public.report_categories (
        organization_id,
        name,
        description,
        active,
        severity_default,
        restricted_by_default
      ) values (
        organization_uuid,
        category_name,
        category_description,
        category_active,
        category_priority,
        category_restricted
      );
    else
      update public.report_categories
         set name = category_name,
             description = category_description,
             active = category_active,
             severity_default = category_priority,
             restricted_by_default = category_restricted
       where id = category_uuid
         and organization_id = organization_uuid;

      if not found then
        raise exception 'Categoria nao encontrada para esta organizacao';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.admin_save_categories(jsonb) from public, anon;
grant execute on function public.admin_save_categories(jsonb) to authenticated;

create or replace function public.admin_save_sla(p_policies jsonb)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  organization_uuid uuid;
  item jsonb;
  policy_uuid uuid;
  first_minutes integer;
  triage_minutes_value integer;
  update_minutes integer;
  resolution_minutes integer;
  policy_active boolean;
begin
  if (select auth.uid()) is null
    or not app_private.is_aal2()
    or not app_private.has_staff_role('platform_admin') then
    raise exception 'Acesso administrativo AAL2 obrigatorio';
  end if;

  if jsonb_typeof(p_policies) <> 'array' then
    raise exception 'Lista de SLA invalida';
  end if;

  organization_uuid := app_private.current_org_id();
  if organization_uuid is null then
    raise exception 'Organizacao administrativa nao encontrada';
  end if;

  for item in select value from jsonb_array_elements(p_policies)
  loop
    policy_uuid := nullif(item ->> 'id', '')::uuid;
    if policy_uuid is null then
      raise exception 'Politica de SLA sem identificador';
    end if;

    first_minutes := (item ->> 'first_action_minutes')::integer;
    triage_minutes_value := (item ->> 'triage_minutes')::integer;
    update_minutes := (item ->> 'update_reporter_minutes')::integer;
    resolution_minutes := nullif(item ->> 'resolution_target_minutes', '')::integer;
    policy_active := coalesce((item ->> 'active')::boolean, true);

    if first_minutes < 1 or triage_minutes_value < 1 or update_minutes < 1
      or (resolution_minutes is not null and resolution_minutes < 1) then
      raise exception 'Prazos de SLA devem ser maiores que zero';
    end if;

    if first_minutes > 525600 or triage_minutes_value > 525600 or update_minutes > 525600
      or (resolution_minutes is not null and resolution_minutes > 525600) then
      raise exception 'Prazo de SLA excede o limite de um ano';
    end if;

    update public.sla_policies
       set first_action_minutes = first_minutes,
           triage_minutes = triage_minutes_value,
           update_reporter_minutes = update_minutes,
           resolution_target_minutes = resolution_minutes,
           active = policy_active
     where id = policy_uuid
       and organization_id = organization_uuid
       and category_id is null;

    if not found then
      raise exception 'Politica de SLA nao encontrada para esta organizacao';
    end if;
  end loop;
end;
$$;

revoke all on function public.admin_save_sla(jsonb) from public, anon;
grant execute on function public.admin_save_sla(jsonb) to authenticated;
