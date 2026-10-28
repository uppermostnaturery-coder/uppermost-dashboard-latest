// Normal staging mail remains blocked. Only audited dedicated template tests
// may obtain a recipient/version/window-bound in-process authorization.
export function stagingEmailSuppressionReason(): string | null {
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  const database = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  const base = process.env.COMMUNICATION_BASE_URL?.replace(/\/$/, '');
  const stagingDatabase = 'https://jwsivyxapfnyaafdcdos.supabase.co';
  const stagingBase = 'https://staging.uppermost.store';
  const staging = branch === 'staging' || database === stagingDatabase || base === stagingBase;
  if (!staging) return null;

  if (process.env.VERCEL_ENV !== 'preview' || branch !== 'staging'
      || database !== stagingDatabase || base !== stagingBase
      || process.env.COMMUNICATION_DRY_RUN !== 'true') {
    return 'STAGING_EMAIL_CONFIGURATION_INVALID';
  }
  return 'STAGING_EMAIL_DRY_RUN';
}

const testAuthorization = Symbol('staging-template-test');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type StagingTemplateTestAuthorization = Readonly<{[testAuthorization]:true;versionId:string;destination:string;window:string}>;
const email=(v:unknown)=>typeof v==='string'?v.trim().toLowerCase():'';
export function stagingTemplateTestWindow(versionId:unknown,destination:unknown):string|null {
  if(stagingEmailSuppressionReason()!=='STAGING_EMAIL_DRY_RUN'||process.env.COMMUNICATION_STAGING_TEST_ENABLED!=='true')return null;
  const approved=email(process.env.COMMUNICATION_STAGING_TEST_EMAIL),recipient=email(destination);
  if(!/^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(approved)||recipient!==approved)return null;
  if(!(process.env.COMMUNICATION_ALLOWED_TEST_EMAILS||'').split(',').map(email).includes(approved))return null;
  if(typeof versionId!=='string'||!uuid.test(versionId)||versionId!==process.env.COMMUNICATION_STAGING_TEST_VERSION_ID)return null;
  const window=process.env.COMMUNICATION_STAGING_TEST_EXPIRES_AT||'',remaining=Date.parse(window)-Date.now();
  return Number.isFinite(remaining)&&remaining>0&&remaining<=30*60000?window:null;
}
export function authorizeStagingTemplateTest(input:{customerId:unknown;channel:unknown;versionId:unknown;templateKey:unknown;metadata:Record<string,unknown>}):StagingTemplateTestAuthorization|null {
  const m=input.metadata;
  if(input.customerId!==null||input.channel!=='EMAIL'||input.templateKey!=='EMAIL_QSTASH_INTEGRATION_TEST'||m.communication_test!==true)return null;
  if(typeof m.test_actor_id!=='string'||!uuid.test(m.test_actor_id)||typeof m.test_request_key!=='string'||!uuid.test(m.test_request_key))return null;
  const window=stagingTemplateTestWindow(input.versionId,m.test_destination);
  if(!window||m.staging_test_window!==window)return null;
  return Object.freeze({[testAuthorization]:true as const,versionId:input.versionId as string,destination:email(m.test_destination),window});
}
export function isAuthorizedStagingTemplateTest(authorization:StagingTemplateTestAuthorization|null|undefined,versionId:unknown,destination:unknown):boolean {
  return !!authorization&&authorization[testAuthorization]===true&&authorization.versionId===versionId&&authorization.destination===email(destination)
    &&stagingTemplateTestWindow(versionId,destination)===authorization.window;
}
