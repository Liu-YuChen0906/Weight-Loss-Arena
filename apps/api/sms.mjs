import { createHash, createHmac, randomUUID } from 'node:crypto';

export class SmsDeliveryError extends Error {
  constructor(outcome = 'UNKNOWN', reason) { super('SMS delivery unavailable'); this.outcome = outcome; if (reason === 'BALANCE') this.reason = reason; }
}

// Bounds apply even to an adapter that ignores AbortSignal. Never automatically retry.
async function boundedCall(operation, input, timeoutMs) {
  const controller = new AbortController(); let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => operation({ ...input, signal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SmsDeliveryError()); }, timeoutMs); })
    ]);
    return result;
  } finally { clearTimeout(timer); }
}

export async function dispatchCode(deliver, input, timeoutMs = 8000) {
  const result = await boundedCall(deliver, input, timeoutMs);
  if (result?.status !== 'ACCEPTED') throw new SmsDeliveryError(result?.status === 'FAILED' ? 'FAILED' : 'UNKNOWN');
  return result;
}

export async function verifyProviderCode(verify, input, timeoutMs = 8000) {
  const result = await boundedCall(verify, input, timeoutMs);
  if (!['PASS', 'INVALID'].includes(result?.status)) throw new SmsDeliveryError();
  return result;
}

const sha = value => createHash('sha256').update(value).digest('hex');
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function aliyunAuthorization(accessKeyId, accessKeySecret, headers, query) {
  const keys = Object.keys(headers).sort(), signed = keys.join(';');
  const canonical = ['POST', '/', query, keys.map(k => k + ':' + headers[k].trim() + '\n').join(''), signed, sha('')].join('\n');
  const signature = createHmac('sha256', accessKeySecret).update('ACS3-HMAC-SHA256\n' + sha(canonical)).digest('hex');
  return `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${signed},Signature=${signature}`;
}

const configFields = { accessKeyId: 'SMS_ACCESS_KEY_ID', accessKeySecret: 'SMS_ACCESS_KEY_SECRET', signName: 'SMS_SIGN_NAME', templateCode: 'SMS_TEMPLATE_CODE', securityToken: 'SMS_SECURITY_TOKEN' };
const configFromEnv = env => Object.fromEntries(Object.entries(configFields).map(([key, field]) => [key, env[field]]));
function configIssues(config, provider = 'aliyun') {
  const issues = [];
  for (const key of ['accessKeyId', 'accessKeySecret', 'signName', 'templateCode']) {
    const value = config[key], field = configFields[key];
    if (typeof value !== 'string' || !value.trim()) issues.push({ field, code: 'MISSING', message: '尚未配置' });
    else if (/[\r\n]/.test(value) || value !== value.trim() || (['accessKeyId', 'accessKeySecret'].includes(key) && /\s/.test(value))) issues.push({ field, code: 'INVALID', message: '包含不支持的空白字符' });
  }
  if (typeof config.templateCode === 'string' && config.templateCode.trim() && !(provider === 'aliyun-pnvs' ? /^\d+$/ : /^SMS_\d+$/).test(config.templateCode)) issues.push({ field: 'SMS_TEMPLATE_CODE', code: 'INVALID', message: provider === 'aliyun-pnvs' ? '需要数字短信认证模板编号' : '需要 SMS_ 开头的数字模板编号' });
  if (config.securityToken !== undefined && config.securityToken !== '' && (typeof config.securityToken !== 'string' || /\s/.test(config.securityToken))) issues.push({ field: 'SMS_SECURITY_TOKEN', code: 'INVALID', message: '临时凭据格式不正确' });
  return issues;
}

// Offline preparation only: never instantiate a server, open data or send a request.
export function inspectSmsConfiguration(env = process.env) {
  const issues = [];
  if (!env.SMS_PROVIDER) issues.push({ field: 'SMS_PROVIDER', code: 'MISSING', message: '尚未指定服务商适配器' });
  else if (!['aliyun', 'aliyun-pnvs'].includes(env.SMS_PROVIDER)) issues.push({ field: 'SMS_PROVIDER', code: 'UNSUPPORTED', message: '当前支持阿里云普通短信或 PNVS 短信认证适配器' });
  if (['aliyun', 'aliyun-pnvs'].includes(env.SMS_PROVIDER)) issues.push(...configIssues(configFromEnv(env), env.SMS_PROVIDER));
  return { ok: issues.length === 0, scope: 'CONFIGURATION_ONLY', networkUsed: false, smsSent: false, deliveryVerified: false, issues };
}

// Optional integration; selecting this adapter is separate from approving a supplier.
export function createAliyunSms({ accessKeyId, accessKeySecret, signName, templateCode, securityToken }, { fetchImpl = fetch, clock = () => new Date(), nonce = randomUUID } = {}) {
  if (configIssues({ accessKeyId, accessKeySecret, signName, templateCode, securityToken }).length) throw new Error('Invalid or incomplete SMS configuration');
  return async ({ phone, code, signal }) => {
    if (!/^1[3-9]\d{9}$/.test(phone) || !/^\d{6}$/.test(code)) throw new SmsDeliveryError('FAILED');
    const query = Object.entries({ PhoneNumbers: phone, SignName: signName, TemplateCode: templateCode, TemplateParam: JSON.stringify({ code }) })
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => encode(k) + '=' + encode(v)).join('&');
    const headers = { host: 'dysmsapi.aliyuncs.com', 'x-acs-action': 'SendSms', 'x-acs-version': '2017-05-25',
      'x-acs-date': clock().toISOString().replace(/\.\d{3}Z$/, 'Z'), 'x-acs-signature-nonce': nonce(), 'x-acs-content-sha256': sha(''),
      ...(securityToken ? { 'x-acs-security-token': securityToken } : {}) };
    headers.Authorization = aliyunAuthorization(accessKeyId, accessKeySecret, headers, query);
    try {
      // HTTPS fixed endpoint, redirects disabled; no credentials or values in application logs.
      const response = await fetchImpl('https://dysmsapi.aliyuncs.com/?' + query, { method: 'POST', headers, signal, redirect: 'error' });
      const body = await response.json();
      if (response.ok && body?.Code === 'OK' && typeof body.BizId === 'string' && body.BizId) return { status: 'ACCEPTED' };
      if (response.status < 500 && typeof body?.Code === 'string' && body.Code !== 'OK') throw new SmsDeliveryError('FAILED');
      throw new SmsDeliveryError();
    } catch (error) { throw new SmsDeliveryError(error instanceof SmsDeliveryError ? error.outcome : 'UNKNOWN'); }
  };
}

export function loadSmsAdapter(env = process.env, dependencies) {
  if (env.SMS_PROVIDER === 'aliyun-pnvs') return createAliyunPnvs(configFromEnv(env), dependencies);
  if (env.SMS_PROVIDER !== 'aliyun') throw new Error('Unsupported or missing SMS_PROVIDER');
  return createAliyunSms(configFromEnv(env), dependencies);
}

// PNVS owns both generation and verification. Never request or persist its plaintext OTP.
export function createAliyunPnvs(config, { fetchImpl = fetch, clock = () => new Date(), nonce = randomUUID } = {}) {
  if (configIssues(config, 'aliyun-pnvs').length) throw new Error('Invalid or incomplete SMS configuration');
  const { accessKeyId, accessKeySecret, signName, templateCode, securityToken } = config;
  async function call(action, parameters, signal) {
    const query = Object.entries(parameters).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => encode(k) + '=' + encode(String(v))).join('&');
    const headers = { host: 'dypnsapi.aliyuncs.com', 'x-acs-action': action, 'x-acs-version': '2017-05-25',
      'x-acs-date': clock().toISOString().replace(/\.\d{3}Z$/, 'Z'), 'x-acs-signature-nonce': nonce(), 'x-acs-content-sha256': sha(''),
      ...(securityToken ? { 'x-acs-security-token': securityToken } : {}) };
    headers.Authorization = aliyunAuthorization(accessKeyId, accessKeySecret, headers, query);
    try {
      const response = await fetchImpl('https://dypnsapi.aliyuncs.com/?' + query, { method: 'POST', headers, signal, redirect: 'error' });
      const body = await response.json();
      if (response.ok && body?.Code === 'OK' && body.Success === true) return body.Model;
      if (response.status < 500 && typeof body?.Code === 'string' && body.Code !== 'OK') throw new SmsDeliveryError('FAILED', ['RESOURCE_NOT_ENOUGH', 'isv.OUT_OF_SERVICE'].includes(body.Code) ? 'BALANCE' : undefined);
      throw new SmsDeliveryError();
    } catch (error) { throw new SmsDeliveryError(error instanceof SmsDeliveryError ? error.outcome : 'UNKNOWN', error instanceof SmsDeliveryError ? error.reason : undefined); }
  }
  function validate(phone, dispatchId) {
    if (!/^1[3-9]\d{9}$/.test(phone) || typeof dispatchId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(dispatchId)) throw new SmsDeliveryError('FAILED');
  }
  const deliver = async ({ phone, dispatchId, signal }) => {
    validate(phone, dispatchId);
    const model = await call('SendSmsVerifyCode', { CountryCode: '86', PhoneNumber: phone, SignName: signName, TemplateCode: templateCode,
      TemplateParam: JSON.stringify({ code: '##code##', min: '5' }), CodeType: 1, CodeLength: 6, ValidTime: 300,
      DuplicatePolicy: 1, Interval: 60, ReturnVerifyCode: false, AutoRetry: 0, OutId: dispatchId }, signal);
    if (typeof model?.BizId !== 'string' || !model.BizId || model.OutId !== dispatchId) throw new SmsDeliveryError();
    return { status: 'ACCEPTED' };
  };
  deliver.verifyCode = async ({ phone, code, dispatchId, signal }) => {
    validate(phone, dispatchId);
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new SmsDeliveryError('FAILED');
    const model = await call('CheckSmsVerifyCode', { CountryCode: '86', PhoneNumber: phone, VerifyCode: code, OutId: dispatchId }, signal);
    if (model?.OutId !== dispatchId || !['PASS', 'UNKNOWN'].includes(model?.VerifyResult)) throw new SmsDeliveryError();
    return { status: model.VerifyResult === 'PASS' ? 'PASS' : 'INVALID' };
  };
  return deliver;
}
