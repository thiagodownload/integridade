-- Canal de Integridade v0.19
-- Eventos automáticos para mudanças de status, prioridade e equipe.

CREATE OR REPLACE FUNCTION operations_private.log_report_state_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_summary text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    v_summary := CASE NEW.status
      WHEN 'new' THEN 'O relato está aguardando triagem.'
      WHEN 'triage' THEN 'O relato está em triagem.'
      WHEN 'investigating' THEN 'A análise do relato está em andamento.'
      WHEN 'waiting_reporter' THEN 'A equipe aguarda uma informação complementar.'
      WHEN 'waiting_internal' THEN 'O relato segue em análise interna.'
      WHEN 'resolved' THEN 'A apuração foi concluída.'
      WHEN 'closed' THEN 'O relato foi encerrado.'
      WHEN 'dismissed' THEN 'A análise do relato foi concluída.'
      ELSE NULL
    END;
    INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
    VALUES(NEW.id,'status_changed',v_summary,jsonb_build_object('before',OLD.status,'after',NEW.status),(SELECT auth.uid()));
  END IF;

  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
    VALUES(NEW.id,'priority_changed',NULL,jsonb_build_object('before',OLD.priority,'after',NEW.priority),(SELECT auth.uid()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS report_state_timeline ON public.reports;
CREATE TRIGGER report_state_timeline
AFTER UPDATE OF status,priority ON public.reports
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.priority IS DISTINCT FROM NEW.priority)
EXECUTE FUNCTION operations_private.log_report_state_event();

CREATE OR REPLACE FUNCTION operations_private.log_assignment_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_name text;
  v_actor uuid;
BEGIN
  SELECT display_name INTO v_name FROM public.staff_profiles WHERE user_id=NEW.user_id;
  v_actor := COALESCE(NEW.assigned_by,(SELECT auth.uid()));

  IF TG_OP='INSERT' AND NEW.revoked_at IS NULL THEN
    INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
    VALUES(NEW.report_id,
      CASE WHEN NEW.assignment_type='principal' THEN 'principal_assigned' ELSE 'collaborator_added' END,
      NULL,
      jsonb_build_object('userId',NEW.user_id,'displayName',v_name),
      v_actor);
    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE' THEN
    IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
      INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
      VALUES(NEW.report_id,
        CASE WHEN OLD.assignment_type='principal' THEN 'principal_revoked' ELSE 'collaborator_removed' END,
        NULL,
        jsonb_build_object('userId',NEW.user_id,'displayName',v_name),
        v_actor);
    ELSIF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
      INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
      VALUES(NEW.report_id,
        CASE WHEN NEW.assignment_type='principal' THEN 'principal_assigned' ELSE 'collaborator_added' END,
        NULL,
        jsonb_build_object('userId',NEW.user_id,'displayName',v_name),
        v_actor);
    ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NULL AND OLD.assignment_type IS DISTINCT FROM NEW.assignment_type THEN
      INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
      VALUES(NEW.report_id,
        CASE WHEN OLD.assignment_type='principal' THEN 'principal_revoked' ELSE 'collaborator_removed' END,
        NULL,
        jsonb_build_object('userId',NEW.user_id,'displayName',v_name),
        v_actor);
      INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
      VALUES(NEW.report_id,
        CASE WHEN NEW.assignment_type='principal' THEN 'principal_assigned' ELSE 'collaborator_added' END,
        NULL,
        jsonb_build_object('userId',NEW.user_id,'displayName',v_name),
        v_actor);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS report_assignment_timeline ON public.report_assignments;
CREATE TRIGGER report_assignment_timeline
AFTER INSERT OR UPDATE OF assignment_type,revoked_at ON public.report_assignments
FOR EACH ROW
EXECUTE FUNCTION operations_private.log_assignment_event();

REVOKE ALL ON FUNCTION operations_private.log_report_state_event() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION operations_private.log_assignment_event() FROM PUBLIC,anon,authenticated;
