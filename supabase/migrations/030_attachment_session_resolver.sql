-- Canal de Integridade v0.30
-- Validação antecipada da sessão temporária de anexos.

CREATE OR REPLACE FUNCTION public.get_public_attachment_session_internal(p_token_digest text)
RETURNS TABLE(report_id uuid,organization_id uuid,remaining_files integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,private,pg_temp
AS $$
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'Somente service_role';
  END IF;

  RETURN QUERY
  SELECT s.report_id,r.organization_id,(s.max_files-s.files_uploaded)
  FROM private.public_attachment_upload_sessions s
  JOIN public.reports r ON r.id=s.report_id
  WHERE s.token_digest=p_token_digest
    AND s.closed_at IS NULL
    AND s.expires_at>now()
    AND s.files_uploaded<s.max_files
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_attachment_session_internal(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_attachment_session_internal(text) TO service_role;
