-- Canal de Integridade v0.2
-- Endurecimento de privilégios, tratamento de casos restritos e dados iniciais.

-- Organização inicial.
insert into public.organizations (name, slug)
values ('Canal de Integridade', 'integridade')
on conflict (slug) do update set name = excluded.name;

insert into public.site_settings (
  organization_id,
  public_name,
  welcome_text,
  allow_anonymous,
  allow_optional_email,
  allow_attachments,
  default_timezone,
  privacy_notice_version
)
select
  id,
  'Canal de Integridade',
  'Um ambiente seguro e confidencial para registrar e acompanhar relatos.',
  true,
  true,
  true,
  'America/Sao_Paulo',
  '2026-08'
from public.organizations
where slug = 'integridade'
on conflict (organization_id) do nothing;

-- Categorias iniciais. Podem ser alteradas posteriormente no painel administrativo.
insert into public.report_categories (
  organization_id,
  name,
  description,
  severity_default,
  restricted_by_default
)
select o.id, v.name, v.description, v.priority::public.report_priority, v.restricted
from public.organizations o
cross join (values
  ('Assédio moral', 'Condutas abusivas, humilhações, constrangimentos ou perseguições no ambiente de trabalho.', 'high', true),
  ('Assédio sexual e outras formas de violência', 'Situações de assédio sexual, importunação, ameaça ou outras formas de violência.', 'critical', true),
  ('Discriminação', 'Discriminação, preconceito ou tratamento desigual relacionado a característica pessoal protegida.', 'high', true),
  ('Fraude ou corrupção', 'Suspeitas de fraude, suborno, corrupção, desvio ou irregularidade financeira.', 'critical', false),
  ('Conflito de interesses', 'Situações em que interesses pessoais possam interferir em decisões profissionais.', 'medium', false),
  ('Segurança e saúde no trabalho', 'Riscos ocupacionais, práticas inseguras ou situações que possam comprometer a saúde e a segurança.', 'high', false),
  ('Violação de políticas internas', 'Descumprimento de normas, políticas, código de conduta ou procedimentos internos.', 'medium', false),
  ('Outros', 'Relatos que não se enquadram nas categorias anteriores.', 'medium', false)
) as v(name, description, priority, restricted)
where o.slug = 'integridade'
  and not exists (
    select 1
    from public.report_categories c
    where c.organization_id = o.id
      and lower(c.name) = lower(v.name)
  );

create unique index if not exists report_categories_org_name_uniq
  on public.report_categories (organization_id, lower(name));

-- SLA inicial em minutos corridos. Um calendário de dias úteis/feriados será adicionado em fase posterior.
insert into public.sla_policies (
  organization_id,
  category_id,
  priority,
  first_action_minutes,
  triage_minutes,
  update_reporter_minutes,
  resolution_target_minutes,
  active
)
select o.id, null, v.priority::public.report_priority, v.first_action, v.triage, v.update_reporter, v.resolution, true
from public.organizations o
cross join (values
  ('critical', 240, 480, 1440, 10080),
  ('high', 480, 1440, 2880, 20160),
  ('medium', 1440, 2880, 4320, 43200),
  ('low', 2880, 4320, 10080, 60480)
) as v(priority, first_action, triage, update_reporter, resolution)
where o.slug = 'integridade'
  and not exists (
    select 1
    from public.sla_policies s
    where s.organization_id = o.id
      and s.category_id is null
      and s.priority = v.priority::public.report_priority
      and s.active = true
  );

-- Casos restritos exigem privacy_officer ou permissão/atribuição explícita.
-- Compliance managers continuam com visão geral apenas para casos não restritos.
create or replace function public.can_access_report(target_report uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reports rep
    where rep.id = target_report
      and rep.organization_id = public.current_org_id()
      and (
        exists (
          select 1
          from public.report_assignments a
          where a.report_id = rep.id
            and a.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.report_permissions rp
          where rp.report_id = rep.id
            and rp.user_id = auth.uid()
            and rp.can_read
        )
        or (not rep.restricted and public.has_staff_role('compliance_manager'))
        or (rep.restricted and public.has_staff_role('privacy_officer'))
      )
  )
$$;

-- Leitura das configurações e catálogos básicos por colaboradores ativos da própria organização.
create policy "active staff reads own organization"
on public.organizations for select to authenticated
using (id = public.current_org_id());

create policy "active staff reads site settings"
on public.site_settings for select to authenticated
using (organization_id = public.current_org_id());

create policy "active staff reads categories"
on public.report_categories for select to authenticated
using (organization_id = public.current_org_id());

create policy "staff reads own profile"
on public.staff_profiles for select to authenticated
using (user_id = auth.uid());

create policy "case managers read org staff"
on public.staff_profiles for select to authenticated
using (
  organization_id = public.current_org_id()
  and (public.has_staff_role('compliance_manager') or public.has_staff_role('privacy_officer'))
);

create policy "staff reads own roles"
on public.staff_roles for select to authenticated
using (user_id = auth.uid());

create policy "case managers read org roles"
on public.staff_roles for select to authenticated
using (
  exists (
    select 1
    from public.staff_profiles p
    where p.user_id = staff_roles.user_id
      and p.organization_id = public.current_org_id()
  )
  and (public.has_staff_role('compliance_manager') or public.has_staff_role('privacy_officer'))
);

-- Atualiza a regra de atribuição para permitir triagem segura de casos restritos pelo privacy officer.
drop policy if exists "managers manage assignments" on public.report_assignments;
create policy "case managers manage assignments"
on public.report_assignments for all to authenticated
using (
  public.can_access_report(report_id)
  and (public.has_staff_role('compliance_manager') or public.has_staff_role('privacy_officer'))
)
with check (
  public.can_access_report(report_id)
  and (public.has_staff_role('compliance_manager') or public.has_staff_role('privacy_officer'))
);

create policy "case managers read permissions"
on public.report_permissions for select to authenticated
using (
  public.can_access_report(report_id)
  and (public.has_staff_role('compliance_manager') or public.has_staff_role('privacy_officer'))
);

create policy "case managers insert permissions"
on public.report_permissions for insert to authenticated
with check (
  public.can_access_report(report_id)
  and (public.has_staff_role('compliance_manager') or public.has_staff_role('privacy_officer'))
);

create policy "case managers update permissions"
on public.report_permissions for update to authenticated
using (
  public.can_access_report(report_id)
  and (public.has_staff_role('compliance_manager') or public.has_staff_role('privacy_officer'))
)
with check (
  public.can_access_report(report_id)
  and (public.has_staff_role('compliance_manager') or public.has_staff_role('privacy_officer'))
);

create policy "case managers delete permissions"
on public.report_permissions for delete to authenticated
using (
  public.can_access_report(report_id)
  and (public.has_staff_role('compliance_manager') or public.has_staff_role('privacy_officer'))
);

-- Privilégio mínimo. RLS continua sendo a segunda camada de autorização.
revoke all privileges on table public.organizations from anon, authenticated;
revoke all privileges on table public.site_settings from anon, authenticated;
revoke all privileges on table public.staff_profiles from anon, authenticated;
revoke all privileges on table public.staff_roles from anon, authenticated;
revoke all privileges on table public.report_categories from anon, authenticated;
revoke all privileges on table public.sla_policies from anon, authenticated;
revoke all privileges on table public.reports from anon, authenticated;
revoke all privileges on table public.report_protocols from anon, authenticated;
revoke all privileges on table public.report_contacts from anon, authenticated;
revoke all privileges on table public.report_assignments from anon, authenticated;
revoke all privileges on table public.report_permissions from anon, authenticated;
revoke all privileges on table public.report_messages from anon, authenticated;
revoke all privileges on table public.report_events from anon, authenticated;
revoke all privileges on table public.notification_rules from anon, authenticated;
revoke all privileges on table public.notification_outbox from anon, authenticated;
revoke all privileges on table public.push_subscriptions from anon, authenticated;
revoke all privileges on table public.audit_events from anon, authenticated;

grant select on table public.organizations to authenticated;
grant select, update on table public.site_settings to authenticated;
grant select on table public.staff_profiles to authenticated;
grant select on table public.staff_roles to authenticated;
grant select, insert, update, delete on table public.report_categories to authenticated;
grant select, insert, update, delete on table public.sla_policies to authenticated;
grant select, update on table public.reports to authenticated;
grant select, insert, update, delete on table public.report_assignments to authenticated;
grant select, insert, update, delete on table public.report_permissions to authenticated;
grant select, insert on table public.report_messages to authenticated;
grant select, insert on table public.report_events to authenticated;
grant select, insert, update, delete on table public.notification_rules to authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
grant select on table public.audit_events to authenticated;

-- Functions SECURITY DEFINER não ficam executáveis por anon/PUBLIC.
revoke all on function public.current_org_id() from public, anon;
revoke all on function public.has_staff_role(public.staff_role) from public, anon;
revoke all on function public.can_access_report(uuid) from public, anon;
grant execute on function public.current_org_id() to authenticated, service_role;
grant execute on function public.has_staff_role(public.staff_role) to authenticated, service_role;
grant execute on function public.can_access_report(uuid) to authenticated, service_role;
