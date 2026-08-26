import { createClient } from 'npm:@supabase/supabase-js@2'
import { unzipSync } from 'npm:fflate@0.8.2'
import { requiredEnv } from '../_shared/security.ts'
import { GatewayAuthError, gatewayIdentityDigest, verifyVercelGateway } from '../_shared/vercel-gateway.ts'

const QUARANTINE_BUCKET = 'report-attachments-quarantine'
const CLEAN_BUCKET = 'report-attachments-clean'
const MAX_ORIGINAL_BYTES = 3 * 1024 * 1024
const MAX_CLEAN_BYTES = 8 * 1024 * 1024
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const responseHeaders = { 'content-type':'application/json; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff' }

function reply(status:number,body:Record<string,unknown>){return new Response(JSON.stringify(body),{status,headers:responseHeaders})}
function cleanFileName(value:string){const last=value.split(/[\\/]/).pop()??'anexo';return last.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,180)||'anexo'}
async function sha256Hex(value:string|Uint8Array){const input=typeof value==='string'?new TextEncoder().encode(value):value;const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',input));return[...digest].map(byte=>byte.toString(16).padStart(2,'0')).join('')}
function ascii(bytes:Uint8Array,start:number,end:number){return new TextDecoder('ascii').decode(bytes.slice(start,end))}
function isZip(bytes:Uint8Array){return bytes.length>=4&&bytes[0]===0x50&&bytes[1]===0x4b&&[0x03,0x05,0x07].includes(bytes[2])&&[0x04,0x06,0x08].includes(bytes[3])}
function validOoxml(bytes:Uint8Array,mime:string){if(!isZip(bytes)||![DOCX,XLSX,PPTX].includes(mime))return false;try{const files=unzipSync(bytes);const names=new Set(Object.keys(files));if(!names.has('[Content_Types].xml'))return false;if(mime===DOCX)return names.has('word/document.xml');if(mime===XLSX)return names.has('xl/workbook.xml');return names.has('ppt/presentation.xml')}catch{return false}}
function validText(bytes:Uint8Array){try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return !text.includes('\u0000')&&!/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)}catch{return false}}
function detectedMime(bytes:Uint8Array,claimed:string):string|null{
 if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return'image/jpeg'
 if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a)return'image/png'
 if(bytes.length>=12&&ascii(bytes,0,4)==='RIFF'&&ascii(bytes,8,12)==='WEBP')return'image/webp'
 if(bytes.length>=5&&ascii(bytes,0,5)==='%PDF-')return'application/pdf'
 if(bytes.length>=12&&ascii(bytes,0,4)==='RIFF'&&ascii(bytes,8,12)==='WAVE')return'audio/wav'
 if((bytes.length>=3&&ascii(bytes,0,3)==='ID3')||(bytes.length>=2&&bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0))return'audio/mpeg'
 if(validOoxml(bytes,claimed))return claimed
 if((claimed==='text/plain'||claimed==='text/csv')&&validText(bytes))return claimed
 return null
}
function allowedMapping(originalMime:string,cleanMime:string){if(['image/jpeg','image/png','image/webp'].includes(originalMime))return cleanMime==='image/webp';return originalMime===cleanMime&&['application/pdf',DOCX,XLSX,PPTX,'text/plain','text/csv','audio/mpeg','audio/wav'].includes(originalMime)}
function cleanExtension(mime:string){if(mime==='image/webp')return'webp';if(mime==='application/pdf')return'pdf';if(mime===DOCX)return'docx';if(mime===XLSX)return'xlsx';if(mime===PPTX)return'pptx';if(mime==='text/plain')return'txt';if(mime==='text/csv')return'csv';if(mime==='audio/mpeg')return'mp3';if(mime==='audio/wav')return'wav';return'bin'}

Deno.serve(async(req)=>{
 if(req.method!=='POST')return reply(405,{error:'method_not_allowed'})
 try{
  await verifyVercelGateway(req)
  const identityDigest=gatewayIdentityDigest(req)
  const attachmentToken=(req.headers.get('x-attachment-token')??'').trim()
  if(!attachmentToken||attachmentToken.length>256)return reply(400,{error:'invalid_attachment_session'})
  const service=createClient(requiredEnv('SUPABASE_URL'),requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}})
  const{data:rateAllowed,error:rateError}=await service.rpc('claim_public_rate_limit_internal',{p_identity_digest:identityDigest,p_action:'upload_attachment',p_limit:20,p_window_seconds:3600})
  if(rateError)return reply(503,{error:'rate_limit_unavailable'});if(rateAllowed!==true)return reply(429,{error:'too_many_requests'})
  const tokenDigest=await sha256Hex(attachmentToken)
  const{data:sessionRows,error:sessionError}=await service.rpc('get_public_attachment_session_internal',{p_token_digest:tokenDigest})
  const session=Array.isArray(sessionRows)?sessionRows[0]:null
  if(sessionError||!session?.report_id||!session?.organization_id||Number(session.remaining_files??0)<1)return reply(403,{error:'attachment_session_invalid'})
  const form=await req.formData();const original=form.get('original');const clean=form.get('clean');const originalNameValue=form.get('originalName');const originalMimeValue=form.get('originalMime');const cleanMimeValue=form.get('cleanMime')
  if(!(original instanceof File)||!(clean instanceof File))return reply(400,{error:'invalid_attachment_payload'})
  const originalName=cleanFileName(typeof originalNameValue==='string'?originalNameValue:original.name)
  const claimedOriginalMime=typeof originalMimeValue==='string'?originalMimeValue:original.type
  const claimedCleanMime=typeof cleanMimeValue==='string'?cleanMimeValue:clean.type
  if(original.size<1||original.size>MAX_ORIGINAL_BYTES||clean.size<1||clean.size>MAX_CLEAN_BYTES)return reply(413,{error:'attachment_too_large'})
  const originalBytes=new Uint8Array(await original.arrayBuffer());const cleanBytes=new Uint8Array(await clean.arrayBuffer())
  const actualOriginalMime=detectedMime(originalBytes,claimedOriginalMime);const actualCleanMime=detectedMime(cleanBytes,claimedCleanMime)
  if(!actualOriginalMime||actualOriginalMime!==claimedOriginalMime||!actualCleanMime||actualCleanMime!==claimedCleanMime||!allowedMapping(actualOriginalMime,actualCleanMime))return reply(400,{error:'attachment_signature_mismatch'})
  const attachmentId=crypto.randomUUID(),reportId=String(session.report_id),organizationId=String(session.organization_id),basePath=`${organizationId}/${reportId}/${attachmentId}`,originalPath=`${basePath}/original`,cleanPath=`${basePath}/view.${cleanExtension(actualCleanMime)}`
  const[originalHash,cleanHash]=await Promise.all([sha256Hex(originalBytes),sha256Hex(cleanBytes)])
  const originalUpload=await service.storage.from(QUARANTINE_BUCKET).upload(originalPath,originalBytes,{contentType:actualOriginalMime,cacheControl:'0',upsert:false});if(originalUpload.error)return reply(500,{error:'quarantine_store_failed'})
  const cleanUpload=await service.storage.from(CLEAN_BUCKET).upload(cleanPath,cleanBytes,{contentType:actualCleanMime,cacheControl:'0',upsert:false});if(cleanUpload.error){await service.storage.from(QUARANTINE_BUCKET).remove([originalPath]);return reply(500,{error:'clean_store_failed'})}
  const{error:registerError}=await service.rpc('register_clean_attachment_internal',{p_token_digest:tokenDigest,p_attachment_id:attachmentId,p_original_name:originalName,p_original_mime:actualOriginalMime,p_clean_mime:actualCleanMime,p_original_size:originalBytes.byteLength,p_original_sha256:originalHash,p_original_path:originalPath,p_clean_size:cleanBytes.byteLength,p_clean_sha256:cleanHash,p_clean_path:cleanPath})
  if(registerError){await Promise.all([service.storage.from(QUARANTINE_BUCKET).remove([originalPath]),service.storage.from(CLEAN_BUCKET).remove([cleanPath])]);return reply(400,{error:'attachment_registration_failed'})}
  return reply(201,{ok:true,attachmentId})
 }catch(error){if(error instanceof GatewayAuthError)return reply(error.status,{error:error.code});return reply(500,{error:'unexpected_error'})}
})
