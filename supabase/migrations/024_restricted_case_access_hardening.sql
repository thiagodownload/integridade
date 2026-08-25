-- Canal de Integridade v0.24
-- Hardening do circuito de casos restritos.
-- Acesso operacional passa a depender apenas de papel valido + atribuicao ativa,
-- sem permissao avulsa via report_permissions.

CREATE OR REPLACE FUNCTION app_private.can_access_report(target_report uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
  SELECT app_private.is_aal2()
    AND EXISTS (
      SELECT 1
      FROM public.reports rep
      WHERE rep.id = target_report
        AND rep.organization_id = app_private.current_org_id()
        AND (
          (
            EXISTS (
              SELECT 1
              FROM public.report_assignments a
              WHERE a.report_id = rep.id
                AND a.user_id = (SELECT auth.uid())
                AND a.revoked_at IS NULL
            )
            AND (
              (NOT rep.restricted AND (
                app_private.has_staff_role('compliance_manager')
                OR app_private.has_staff_role('investigator')
              ))
              OR
              (rep.restricted AND (
                app_private.has_staff_role('privacy_officer')
                OR app_private.has_staff_role('investigator')
              ))
            )
          )
          OR (NOT rep.restricted AND app_private.has_staff_role('compliance_manager'))
          OR (rep.restricted AND app_private.has_staff_role('privacy_officer'))
        )
    )
$$;

-- report_permissions fica preservada apenas como estrutura historica/interna.
-- O frontend autenticado nao pode mais conceder acessos fora do modelo principal + colaboradores.
DROP POLICY IF EXISTS "case managers delete permissions" ON public.report_permissions;
DROP POLICY IF EXISTS "case managers insert permissions" ON public.report_permissions;
DROP POLICY IF EXISTS "case managers read permissions" ON public.report_permissions;
DROP POLICY IF EXISTS "case managers update permissions" ON public.report_permissions;
REVOKE ALL ON TABLE public.report_permissions FROM anon, authenticated;
COMMENT ON TABLE public.report_permissions IS 'Estrutura legada/interna. Acesso operacional e concedido por report_assignments e papeis ativos.';

CREATE OR REPLACE FUNCTION operations_private.log_restricted_assignment_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_restricted boolean := false;
  v_org_id uuid;
  v_actor uuid := COALESCE((SELECT auth.uid()), NEW.assigned_by);
BEGIN
  SELECT r.restricted, r.organization_id
    INTO v_restricted, v_org_id
  FROM public.reports r
  WHERE r.id = NEW.report_id;

  IF NOT COALESCE(v_restricted,false) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.revoked_at IS NULL THEN
    INSERT INTO public.audit_events(
      organization_id, actor_user_id, action, object_type, object_id, metadata
    ) VALUES (
      v_org_id,
      v_actor,
      'report.restricted.access.granted',
      'report',
      NEW.report_id::text,
      jsonb_build_object(
        'target_user_id', NEW.user_id,
        'assignment_type', NEW.assignment_type
      )
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
      INSERT INTO public.audit_events(
        organization_id, actor_user_id, action, object_type, object_id, metadata
      ) VALUES (
        v_org_id,
        COALESCE((SELECT auth.uid()), NEW.assigned_by),
        'report.restricted.access.revoked',
        'report',
        NEW.report_id::text,
        jsonb_build_object(
          'target_user_id', NEW.user_id,
          'assignment_type', OLD.assignment_type
        )
      );
    ELSIF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
      INSERT INTO public.audit_events(
        organization_id, actor_user_id, action, object_type, object_id, metadata
      ) VALUES (
        v_org_id,
        COALESCE((SELECT auth.uid()), NEW.assigned_by),
        'report.restricted.access.granted',
        'report',
        NEW.report_id::text,
        jsonb_build_object(
          'target_user_id', NEW.user_id,
          'assignment_type', NEW.assignment_type
        )
      );
    ELSIF OLD.revoked_at IS NULL
      AND NEW.revoked_at IS NULL
      AND OLD.assignment_type IS DISTINCT FROM NEW.assignment_type THEN
      INSERT INTO public.audit_events(
        organization_id, actor_user_id, action, object_type, object_id, metadata
      ) VALUES
      (
        v_org_id,
        COALESCE((SELECT auth.uid()), NEW.assigned_by),
        'report.restricted.access.revoked',
        'report',
        NEW.report_id::text,
        jsonb_build_object(
          'target_user_id', NEW.user_id,
          'assignment_type', OLD.assignment_type
        )
      ),
      (
        v_org_id,
        COALESCE((SELECT auth.uid()), NEW.assigned_by),
        'report.restricted.access.granted',
        'report',
        NEW.report_id::text,
        jsonb_build_object(
          'target_user_id', NEW.user_id,
          'assignment_type', NEW.assignment_type
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS report_restricted_assignment_access_audit ON public.report_assignments;
CREATE TRIGGER report_restricted_assignment_access_audit
AFTER INSERT OR UPDATE OF assignment_type,revoked_at ON public.report_assignments
FOR EACH ROW
EXECUTE FUNCTION operations_private.log_restricted_assignment_access();

REVOKE ALL ON FUNCTION operations_private.log_restricted_assignment_access() FROM PUBLIC,anon,authenticated;
