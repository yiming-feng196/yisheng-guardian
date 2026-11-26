function platform() {
  try {
    if (wx.getDeviceInfo) return wx.getDeviceInfo().platform || '';
    if (wx.getSystemInfoSync) return wx.getSystemInfoSync().platform || '';
  } catch (_) {
    /* A missing device API does not prevent requests. */
  }
  return '';
}

function hostOf(baseUrl) {
  const match = String(baseUrl || '').match(/^https?:\/\/([^/:]+)/i);
  return match ? match[1].toLowerCase() : '';
}

function isLoopback(baseUrl) {
  const host = hostOf(baseUrl);
  return host === 'localhost' || /^127\./.test(host) || host === '0.0.0.0';
}

function connectionHint(baseUrl) {
  const host = hostOf(baseUrl);
  if (!host) return '请填写您要连接的服务器地址。';
  if (isLoopback(baseUrl)) {
    return platform() === 'devtools'
      ? '这是电脑上的本机地址。手机预览请使用电脑的 Wi-Fi 地址。'
      : '这个地址指向手机自身。请改为电脑的 Wi-Fi 地址或线上 HTTPS 服务地址。';
  }
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    return '本机调试：电脑须保持后端运行，手机与电脑须在可互访的 Wi-Fi 中。';
  }
  return '请确认该地址属于您的服务；正式版需要配置 HTTPS 合法域名。';
}

function networkError(error) {
  const detail = String((error && error.errMsg) || '').slice(0, 300);
  let message = '无法连接服务器。请检查服务地址；也可用手机浏览器打开健康检查地址。';
  let code = 'NETWORK_UNAVAILABLE';
  if (/domain list|not in.*domain|url not.*domain|合法域名/i.test(detail)) {
    message = '微信拦截了服务地址。开发版请开启手机端调试后重试；正式版须配置 HTTPS 合法域名。';
    code = 'DOMAIN_NOT_ALLOWED';
  } else if (/ssl|certificate|cert |tls|证书/i.test(detail)) {
    message = '服务器 HTTPS 证书或 TLS 校验失败，请检查服务器证书配置。';
    code = 'TLS_ERROR';
  } else if (/timeout/i.test(detail)) {
    message = '请求超时。请确认电脑后端正在运行，手机与电脑可以互访。';
    code = 'NETWORK_TIMEOUT';
  }
  const result = new Error(message);
  result.code = code;
  result.nativeMessage = detail;
  return result;
}

module.exports = { platform, hostOf, isLoopback, connectionHint, networkError };
