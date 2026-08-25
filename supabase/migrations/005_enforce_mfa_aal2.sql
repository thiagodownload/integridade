-- Canal de Integridade v0.5
-- Exige MFA/AAL2 em todas as rotas de dados internas protegidas por RLS.

create or replace function app_private.is_aal2()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(((select auth.jwt()) ->> 'aal') = 'aal2', false)
$$;

revoke all on function app_private.is_aal2() from public, anon;
grant execute on function app_private.is_aal2() to authenticated, service_role;

-- Os helpers centrais passam a falhar fechados para sessões AAL1.
create or replace function app_private.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select organization_id
  from public.staff_profiles
  where app_private.is_aal2()
    and user_id = (select auth.uid())
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
  select app_private.is_aal2()
    and exists (
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
  select app_private.is_aal2()
    and exists (
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

-- Estas políticas tinham atalhos diretos por auth.uid(); agora também exigem AAL2.
drop policy if exists "staff reads permitted profiles" on public.staff_profiles;
create policy "staff reads permitted profiles"
on public.staff_profiles for select to authenticated
using (
  app_private.is_aal2()
  and (
    user_id = (select auth.uid())
    or (
      organization_id = app_private.current_org_id()
      and (
        app_private.has_staff_role('compliance_manager')
        or app_private.has_staff_role('privacy_officer')
      )
    )
  )
);

drop policy if exists "staff reads permitted roles" on public.staff_roles;
create policy "staff reads permitted roles"
on public.staff_roles for select to authenticated
using (
  app_private.is_aal2()
  and (
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
  )
);

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions"
on public.push_subscriptions for all to authenticated
using (
  app_private.is_aal2()
  and user_id = (select auth.uid())
)
with check (
  app_private.is_aal2()
  and user_id = (select auth.uid())
);
