-- Canal de Integridade v0.18
-- Timeline real, notas internas e comunicação com o denunciante.

DROP POLICY IF EXISTS "authorized staff insert events" ON public.report_events;
DROP POLICY IF EXISTS "authorized staff read events" ON public.report_events;
DROP POLICY IF EXISTS "authorized staff insert messages" ON public.report_messages;
DROP POLICY IF EXISTS "authorized staff read messages" ON public.report_messages;

DROP POLICY IF EXISTS "deny direct report event access" ON public.report_events;
CREATE POLICY "deny direct report event access"
ON public.report_events FOR ALL TO authenticated
USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny direct report message access" ON public.report_messages;
CREATE POLICY "deny direct report message access"
ON public.report_messages FOR ALL TO authenticated
USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION operations_private.operations_get_report_activity(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT app_private.is_aal2() THEN RAISE EXCEPTION 'mfa_required'; END IF;
  IF NOT app_private.can_access_report(p_report_id) THEN RAISE EXCEPTION 'report_access_denied'; END IF;

  SELECT jsonb_build_object(
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',e.id,'eventType',e.event_type,'publicSummary',e.public_summary,
        'internalMetadata',e.internal_metadata,'createdBy',e.created_by,
        'createdByName',sp.display_name,'createdAt',e.created_at
      ) ORDER BY e.created_at,e.id)
      FROM public.report_events e
      LEFT JOIN public.staff_profiles sp ON sp.user_id=e.created_by
      WHERE e.report_id=p_report_id
    ),'[]'::jsonb),
    'messages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',m.id,'authorType',m.author_type,'authorUserId',m.author_user_id,
        'authorName',CASE WHEN m.author_type='reporter' THEN 'Denunciante' WHEN m.author_type='system' THEN 'Sistema' ELSE COALESCE(sp.display_name,'Equipe interna') END,
        'visibility',m.visibility,'body',m.body,'createdAt',m.created_at
      ) ORDER BY m.created_at,m.id)
      FROM public.report_messages m
      LEFT JOIN public.staff_profiles sp ON sp.user_id=m.author_user_id
      WHERE m.report_id=p_report_id
    ),'[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION operations_private.operations_get_report_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION operations_private.operations_get_report_activity(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION operations_private.operations_add_report_message(
  p_report_id uuid, p_visibility public.message_visibility, p_body text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_body text := btrim(COALESCE(p_body,''));
  v_actor uuid := (SELECT auth.uid());
  v_message_id uuid;
  v_is_manager boolean;
  v_is_principal boolean;
  v_is_collaborator boolean;
  v_org_id uuid;
  v_email_enabled boolean := false;
BEGIN
  IF v_actor IS NULL OR NOT app_private.is_aal2() THEN RAISE EXCEPTION 'mfa_required'; END IF;
  IF NOT app_private.can_access_report(p_report_id) THEN RAISE EXCEPTION 'report_access_denied'; END IF;
  IF char_length(v_body)<1 OR char_length(v_body)>8000 THEN RAISE EXCEPTION 'invalid_message_body'; END IF;

  v_is_manager := app_private.can_manage_report_team(p_report_id);
  SELECT EXISTS(SELECT 1 FROM public.report_assignments a WHERE a.report_id=p_report_id AND a.user_id=v_actor AND a.assignment_type='principal' AND a.revoked_at IS NULL) INTO v_is_principal;
  SELECT EXISTS(SELECT 1 FROM public.report_assignments a WHERE a.report_id=p_report_id AND a.user_id=v_actor AND a.assignment_type='collaborator' AND a.revoked_at IS NULL) INTO v_is_collaborator;

  IF p_visibility='internal_only' AND NOT (v_is_manager OR v_is_principal OR v_is_collaborator) THEN RAISE EXCEPTION 'internal_note_denied'; END IF;
  IF p_visibility='reporter_visible' AND NOT (v_is_manager OR v_is_principal) THEN RAISE EXCEPTION 'reporter_message_denied'; END IF;

  INSERT INTO public.report_messages(report_id,author_type,author_user_id,visibility,body)
  VALUES(p_report_id,'staff',v_actor,p_visibility,v_body) RETURNING id INTO v_message_id;

  SELECT r.organization_id INTO v_org_id FROM public.reports r WHERE r.id=p_report_id;

  IF p_visibility='reporter_visible' THEN
    INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
    VALUES(p_report_id,'staff_message_sent','A equipe enviou uma nova mensagem.',jsonb_build_object('message_id',v_message_id),v_actor);

    SELECT COALESCE(c.email_enabled,false) INTO v_email_enabled FROM public.report_contacts c WHERE c.report_id=p_report_id;
    IF v_email_enabled THEN
      INSERT INTO public.notification_outbox(organization_id,report_id,event_type,recipient_reporter,channel,payload)
      VALUES(v_org_id,p_report_id,'reporter_message_created',true,'email',jsonb_build_object('generic',true));
    END IF;
  ELSE
    INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
    VALUES(p_report_id,'internal_note_added',NULL,jsonb_build_object('message_id',v_message_id),v_actor);
  END IF;

  INSERT INTO public.audit_events(organization_id,actor_user_id,action,object_type,object_id,metadata)
  VALUES(v_org_id,v_actor,CASE WHEN p_visibility='reporter_visible' THEN 'report.message.sent' ELSE 'report.note.added' END,'report',p_report_id::text,jsonb_build_object('message_id',v_message_id,'visibility',p_visibility));
  RETURN v_message_id;
END;
$$;

REVOKE ALL ON FUNCTION operations_private.operations_add_report_message(uuid,public.message_visibility,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION operations_private.operations_add_report_message(uuid,public.message_visibility,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.operations_get_report_activity(p_report_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER
SET search_path=public,operations_private,pg_temp
AS $$ SELECT operations_private.operations_get_report_activity(p_report_id) $$;

CREATE OR REPLACE FUNCTION public.operations_add_report_message(p_report_id uuid,p_visibility public.message_visibility,p_body text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path=public,operations_private,pg_temp
AS $$ SELECT operations_private.operations_add_report_message(p_report_id,p_visibility,p_body) $$;

REVOKE ALL ON FUNCTION public.operations_get_report_activity(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.operations_add_report_message(uuid,public.message_visibility,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operations_get_report_activity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operations_add_report_message(uuid,public.message_visibility,text) TO authenticated;
