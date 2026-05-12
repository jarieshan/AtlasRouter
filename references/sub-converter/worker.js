/**
 * Cloudflare Workers 请求转发示例
 * 1. 仅接受 GET 请求
 * 2. 检查 URL 中的 token 参数，若不存在或不匹配，则返回 401 Unauthorized
 * 3. 根据 URL 的 pathname 判断转发目标：
 *    - 以 /clash 开头的请求转发到 http://a.com
 *    - 以 /quanx 开头的请求转发到 http://b.com
 * 4. 转发请求时将 token 参数过滤掉，并保持其他查询参数
 */

const VALID_TOKEN = 'REPLACE_WITH_SUBSCRIBE_TOKEN'; // 示例占位，实际 token 不应提交到仓库

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // 仅接受 GET 请求
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  // 验证 token
  if (!token || token !== VALID_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 根据 pathname 判断转发目标
  const pathname = url.pathname;
  let forwardUrl = '';

  if (pathname.startsWith('/clash')) {
    forwardUrl = 'https://example.invalid/clash-subscription'
  } else if (pathname.startsWith('/quanx')) {
    forwardUrl = 'https://example.invalid/quanx-subscription';
  } else {
    return new Response('Not Found', { status: 404 });
  }

  // 发起 GET 请求转发，注意：此处可以根据需要添加其他请求头、配置等
  const response = await fetch(forwardUrl, {
    method: 'GET',
  });

  // 直接返回目标响应
  return response;
}
