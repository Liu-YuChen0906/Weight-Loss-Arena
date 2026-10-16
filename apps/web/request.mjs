// Retain a write's identity until its result is known, including a lost response body.
export function createRequester({ pendingKeys = new Map(), fetcher = (...args) => fetch(...args), createKey = () => crypto.randomUUID() } = {}) {
  return async function request(path, method = 'GET', body, headers = {}) {
    const payload = body === undefined ? undefined : JSON.stringify(body), signature = method + path + payload;
    const write = method !== 'GET', authSend = path === '/auth/code', authLogin = path === '/auth/login';
    const uncertain = () => {
      const error = new Error(authSend ? '验证码发送结果暂未确认，请等待 60 秒后重新获取' : authLogin ? '登录结果暂未确认，请刷新页面核对登录状态' : write ? '尚未确认保存结果，请恢复连接后核对再重试' : '连接失败，请重试');
      error.code = authSend ? 'SMS_DELIVERY_UNKNOWN' : authLogin ? 'AUTH_RESULT_UNKNOWN' : 'NETWORK';
      if (authSend) error.details = { retryAfter: 60 };
      return error;
    };
    let requestKey;
    headers = { ...headers };
    if (write) {
      if (!pendingKeys.has(signature)) pendingKeys.set(signature, createKey());
      headers['Idempotency-Key'] = pendingKeys.get(signature);
      requestKey = headers['Idempotency-Key'];
    }
    let response, result;
    try {
      response = await fetcher('/api/v1' + path, { method, headers, body: payload, cache: 'no-store', signal: AbortSignal.timeout(12000) });
      result = await response.json();
      if (!result || typeof result !== 'object' || (!response.ok && !result.error)) throw new Error('Invalid response');
    } catch { throw uncertain(); }
    // A server failure may happen after committing. A retry must keep the same key.
    const knownAuthFailure = (authSend || authLogin) && ['SMS_UNAVAILABLE', 'SMS_DELIVERY_UNKNOWN', 'SMS_VERIFICATION_UNAVAILABLE', 'SMS_BALANCE_INSUFFICIENT'].includes(result.error?.code);
    if (response.status >= 500 && !knownAuthFailure) {
      const error = uncertain(); if (!write) error.message = '服务暂时不可用，请重试'; error.status = response.status; throw error;
    }
    if (pendingKeys.get(signature) === requestKey) pendingKeys.delete(signature);
    if (response.ok) return result;
    const error = new Error(result.error?.message || '请求失败');
    error.code = result.error?.code; error.details = result.error?.details; error.status = response.status; throw error;
  };
}
