-- Canal de Integridade v0.8
-- RPCs administrativos passam a SECURITY INVOKER e dependem de RLS/AAL2.

-- Permite apenas a coluna institucional que a tela Geral precisa alterar.
grant update(name) on public.organizations to authenticated;

drop policy if exists "platform admin updates organization name" on public.organizations;
create policy "platform admin updates organization name"
on public.organizations for update to authenticated
using (
  id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
)
with check (
  id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
);

alter function public.admin_update_general_settings(text, text, text, boolean, boolean, boolean, text, text) security invoker;
alter function public.admin_save_categories(jsonb) security invoker;
alter function public.admin_save_sla(jsonb) security invoker;
