-- Canal de Integridade v0.20
-- Entrada de mensagens do denunciante por protocolo. Service role apenas.

CREATE OR REPLACE FUNCTION public.add_reporter_message_internal(
  p_protocol_digest text,
  p_body text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_report_id uuid;
  v_org_id uuid;
  v_message_id uuid;
  v_body text := btrim(COALESCE(p_body,''));
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN RAISE EXCEPTION 'Somente service_role'; END IF;
  IF char_length(v_body)<1 OR char_length(v_body)>8000 THEN RAISE EXCEPTION 'invalid_message_body'; END IF;

  SELECT rp.report_id INTO v_report_id
  FROM public.report_protocols rp
  WHERE rp.protocol_digest=p_protocol_digest;

  IF v_report_id IS NULL THEN RETURN NULL; END IF;
  SELECT organization_id INTO v_org_id FROM public.reports WHERE id=v_report_id;

  INSERT INTO public.report_messages(report_id,author_type,author_user_id,visibility,body)
  VALUES(v_report_id,'reporter',NULL,'reporter_visible',v_body)
  RETURNING id INTO v_message_id;

  INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
  VALUES(v_report_id,'reporter_message_received','Você enviou uma nova mensagem.',jsonb_build_object('message_id',v_message_id),NULL);

  INSERT INTO public.notification_outbox(organization_id,report_id,event_type,recipient_reporter,channel,payload)
  VALUES(v_org_id,v_report_id,'report_message_created',false,'in_app',jsonb_build_object('generic',true));

  RETURN v_message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_reporter_message_internal(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_reporter_message_internal(text,text) TO service_role;
