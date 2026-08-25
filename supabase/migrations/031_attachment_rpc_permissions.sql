-- Canal de Integridade v0.31
-- Alinha os RPCs de anexos ao padrão Operations já validado:
-- wrapper public SECURITY INVOKER + implementação operations_private SECURITY DEFINER.

GRANT EXECUTE ON FUNCTION operations_private.operations_list_report_attachments(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION operations_private.operations_get_attachment_download(uuid) TO authenticated;
