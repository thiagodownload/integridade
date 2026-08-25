-- Canal de Integridade v0.3
-- Helpers RLS fora do schema exposto, políticas consolidadas e índices de FKs.

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

create or replace function app_private.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select organization_id
  from public.staff_profiles
  where user_id = (select auth.uid())
    and active = true
  limit 1
$$;

create or replace function app_private.has_staff_role(required_role public.staff_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.staff_roles r
    join public.staff_profiles p on p.user_id = r.user_id
    where r.user_id = (select auth.uid())
      and r.role = required_role
      and p.active = true
  )
$$;

create or replace function app_private.can_access_report(target_report uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.reports rep
    where rep.id = target_report
      and rep.organization_id = app_private.current_org_id()
      and (
        exists (
          select 1
          from public.report_assignments a
          where a.report_id = rep.id
            and a.user_id = (select auth.uid())
        )
        or exists (
          select 1
          from public.report_permissions rp
          where rp.report_id = rep.id
            and rp.user_id = (select auth.uid())
            and rp.can_read
        )
        or (not rep.restricted and app_private.has_staff_role('compliance_manager'))
        or (rep.restricted and app_private.has_staff_role('privacy_officer'))
      )
  )
$$;

revoke all on function app_private.current_org_id() from public, anon;
revoke all on function app_private.has_staff_role(public.staff_role) from public, anon;
revoke all on function app_private.can_access_report(uuid) from public, anon;
grant execute on function app_private.current_org_id() to authenticated, service_role;
grant execute on function app_private.has_staff_role(public.staff_role) to authenticated, service_role;
grant execute on function app_private.can_access_report(uuid) to authenticated, service_role;

-- Organizações.
drop policy if exists "active staff reads own organization" on public.organizations;
create policy "active staff reads own organization"
on public.organizations for select to authenticated
using (id = app_private.current_org_id());

-- Configurações do site: uma única política de leitura para staff ativo.
drop policy if exists "platform admin reads own org settings" on public.site_settings;
drop policy if exists "active staff reads site settings" on public.site_settings;
drop policy if exists "platform admin updates own org settings" on public.site_settings;
create policy "active staff reads site settings"
on public.site_settings for select to authenticated
using (organization_id = app_private.current_org_id());
create policy "platform admin updates own org settings"
on public.site_settings for update to authenticated
using (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
)
with check (organization_id = app_private.current_org_id());

-- Categorias: leitura para staff ativo; escrita somente platform_admin.
drop policy if exists "platform admin manages categories" on public.report_categories;
drop policy if exists "active staff reads categories" on public.report_categories;
create policy "active staff reads categories"
on public.report_categories for select to authenticated
using (organization_id = app_private.current_org_id());
create policy "platform admin inserts categories"
on public.report_categories for insert to authenticated
with check (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
);
create policy "platform admin updates categories"
on public.report_categories for update to authenticated
using (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
)
with check (organization_id = app_private.current_org_id());
create policy "platform admin deletes categories"
on public.report_categories for delete to authenticated
using (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
);

-- SLA e notificações administrativas.
drop policy if exists "platform admin manages sla" on public.sla_policies;
create policy "platform admin reads sla"
on public.sla_policies for select to authenticated
using (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
);
create policy "platform admin inserts sla"
on public.sla_policies for insert to authenticated
with check (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
);
create policy "platform admin updates sla"
on public.sla_policies for update to authenticated
using (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
)
with check (organization_id = app_private.current_org_id());
create policy "platform admin deletes sla"
on public.sla_policies for delete to authenticated
using (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
);

drop policy if exists "platform admin manages notification rules" on public.notification_rules;
create policy "platform admin reads notification rules"
on public.notification_rules for select to authenticated
using (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
);
create policy "platform admin inserts notification rules"
on public.notification_rules for insert to authenticated
with check (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
);
create policy "platform admin updates notification rules"
on public.notification_rules for update to authenticated
using (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
)
with check (organization_id = app_private.current_org_id());
create policy "platform admin deletes notification rules"
on public.notification_rules for delete to authenticated
using (
  organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
);

-- Perfis e papéis: combina políticas SELECT para evitar políticas permissivas duplicadas.
drop policy if exists "staff reads own profile" on public.staff_profiles;
drop policy if exists "case managers read org staff" on public.staff_profiles;
create policy "staff reads permitted profiles"
on public.staff_profiles for select to authenticated
using (
  user_id = (select auth.uid())
  or (
    organization_id = app_private.current_org_id()
    and (
      app_private.has_staff_role('compliance_manager')
      or app_private.has_staff_role('privacy_officer')
    )
  )
);

drop policy if exists "staff reads own roles" on public.staff_roles;
drop policy if exists "case managers read org roles" on public.staff_roles;
create policy "staff reads permitted roles"
on public.staff_roles for select to authenticated
using (
  user_id = (select auth.uid())
  or (
    exists (
      select 1
      from public.staff_profiles p
      where p.user_id = staff_roles.user_id
        and p.organization_id = app_private.current_org_id()
    )
    and (
      app_private.has_staff_role('compliance_manager')
      or app_private.has_staff_role('privacy_officer')
    )
  )
);

-- Operações.
drop policy if exists "authorized staff read reports" on public.reports;
drop policy if exists "authorized staff update reports" on public.reports;
create policy "authorized staff read reports"
on public.reports for select to authenticated
using (app_private.can_access_report(id));
create policy "authorized staff update reports"
on public.reports for update to authenticated
using (app_private.can_access_report(id))
with check (app_private.can_access_report(id));

drop policy if exists "authorized staff read messages" on public.report_messages;
drop policy if exists "authorized staff insert messages" on public.report_messages;
create policy "authorized staff read messages"
on public.report_messages for select to authenticated
using (app_private.can_access_report(report_id));
create policy "authorized staff insert messages"
on public.report_messages for insert to authenticated
with check (
  app_private.can_access_report(report_id)
  and author_type in ('staff', 'system')
);

drop policy if exists "authorized staff read events" on public.report_events;
drop policy if exists "authorized staff insert events" on public.report_events;
create policy "authorized staff read events"
on public.report_events for select to authenticated
using (app_private.can_access_report(report_id));
create policy "authorized staff insert events"
on public.report_events for insert to authenticated
with check (app_private.can_access_report(report_id));

-- Atribuições: separa SELECT das operações de gestão para não duplicar política SELECT.
drop policy if exists "authorized staff read assignments" on public.report_assignments;
drop policy if exists "case managers manage assignments" on public.report_assignments;
create policy "authorized staff read assignments"
on public.report_assignments for select to authenticated
using (app_private.can_access_report(report_id));
create policy "case managers insert assignments"
on public.report_assignments for insert to authenticated
with check (
  app_private.can_access_report(report_id)
  and (
    app_private.has_staff_role('compliance_manager')
    or app_private.has_staff_role('privacy_officer')
  )
);
create policy "case managers update assignments"
on public.report_assignments for update to authenticated
using (
  app_private.can_access_report(report_id)
  and (
    app_private.has_staff_role('compliance_manager')
    or app_private.has_staff_role('privacy_officer')
  )
)
with check (app_private.can_access_report(report_id));
create policy "case managers delete assignments"
on public.report_assignments for delete to authenticated
using (
  app_private.can_access_report(report_id)
  and (
    app_private.has_staff_role('compliance_manager')
    or app_private.has_staff_role('privacy_officer')
  )
);

-- Permissões de caso.
drop policy if exists "case managers read permissions" on public.report_permissions;
drop policy if exists "case managers insert permissions" on public.report_permissions;
drop policy if exists "case managers update permissions" on public.report_permissions;
drop policy if exists "case managers delete permissions" on public.report_permissions;
create policy "case managers read permissions"
on public.report_permissions for select to authenticated
using (
  app_private.can_access_report(report_id)
  and (
    app_private.has_staff_role('compliance_manager')
    or app_private.has_staff_role('privacy_officer')
  )
);
create policy "case managers insert permissions"
on public.report_permissions for insert to authenticated
with check (
  app_private.can_access_report(report_id)
  and (
    app_private.has_staff_role('compliance_manager')
    or app_private.has_staff_role('privacy_officer')
  )
);
create policy "case managers update permissions"
on public.report_permissions for update to authenticated
using (
  app_private.can_access_report(report_id)
  and (
    app_private.has_staff_role('compliance_manager')
    or app_private.has_staff_role('privacy_officer')
  )
)
with check (app_private.can_access_report(report_id));
create policy "case managers delete permissions"
on public.report_permissions for delete to authenticated
using (
  app_private.can_access_report(report_id)
  and (
    app_private.has_staff_role('compliance_manager')
    or app_private.has_staff_role('privacy_officer')
  )
);

-- Push com initplan para auth.uid().
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions"
on public.push_subscriptions for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Auditoria.
drop policy if exists "auditors read audit events" on public.audit_events;
create policy "auditors read audit events"
on public.audit_events for select to authenticated
using (
  organization_id = app_private.current_org_id()
  and (
    app_private.has_staff_role('auditor')
    or app_private.has_staff_role('compliance_manager')
  )
);

-- Negação explícita nas tabelas exclusivas de service role.
create policy "deny client protocol access"
on public.report_protocols for all to anon, authenticated
using (false)
with check (false);

create policy "deny client contact access"
on public.report_contacts for all to anon, authenticated
using (false)
with check (false);

create policy "deny client outbox access"
on public.notification_outbox for all to anon, authenticated
using (false)
with check (false);

-- Índices de FKs relevantes para fila, auditoria e gestão de usuários.
create index if not exists audit_events_org_idx on public.audit_events(organization_id);
create index if not exists audit_events_actor_idx on public.audit_events(actor_user_id);
create index if not exists notification_outbox_org_idx on public.notification_outbox(organization_id);
create index if not exists notification_outbox_report_idx on public.notification_outbox(report_id);
create index if not exists notification_outbox_recipient_idx on public.notification_outbox(recipient_user_id);
create index if not exists notification_rules_org_idx on public.notification_rules(organization_id);
create index if not exists report_assignments_assigned_by_idx on public.report_assignments(assigned_by);
create index if not exists report_assignments_user_idx on public.report_assignments(user_id);
create index if not exists report_events_created_by_idx on public.report_events(created_by);
create index if not exists report_messages_author_user_idx on public.report_messages(author_user_id);
create index if not exists report_permissions_user_idx on public.report_permissions(user_id);
create index if not exists sla_policies_category_idx on public.sla_policies(category_id);
create index if not exists sla_policies_org_idx on public.sla_policies(organization_id);
create index if not exists staff_profiles_org_idx on public.staff_profiles(organization_id);

-- Os helpers antigos do schema público não são mais necessários.
drop function if exists public.can_access_report(uuid);
drop function if exists public.has_staff_role(public.staff_role);
drop function if exists public.current_org_id();
