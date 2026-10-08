import http from 'node:http'
import https from 'node:https'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-tokenhub-gptfast'

/**
 * Loopback port. A pi-ai route's `baseURL` is static config and loader patches
 * replace a whole `config`, so the port cannot be picked at runtime.
 */
export const PORT = 8788

/** Service-tier values the plugin can request. */
export const TIER_VALUES = ['fast', 'priority']

/** API routes that may carry an injectable body. */
const INJECT_PATHS = new Set(['/v1/responses', '/v1/chat/completions'])

/** Anything outside this prefix is refused instead of forwarded. */
const FORWARD_PREFIX = '/v1/'

// `.volatile()` is what makes these fields editable at runtime: the settings
// form only projects volatile fields, and the loader commits a volatile change
// into the running config without remounting the plugin. Remove it and the
// switch disappears from the Plugins page.
export const Config = z.object({
  enabled: z.boolean().default(false).description('请求 GPT 快速档').volatile(),
  upstreamBaseURL: z.string().default('').description('中转站 API baseURL').volatile(),
  models: z
    .array(z.string())
    .default(['gpt-6-sol', 'gpt-6.1-sol'])
    .description('只对这些模型注入 service_tier')
    .volatile(),
  tier: z.union([z.const('fast'), z.const('priority')]).default('fast').description('请求档位').volatile(),
})

/**
 * Add the service tier to a generation request body.
 *
 * Returns the identical buffer whenever the body must not change: not JSON,
 * not a JSON object, an explicit `service_tier`, or a model outside `models`.
 * Pass `models` as undefined to skip the whitelist check.
 */
export function injectTier(body, models, tier) {
  if (!TIER_VALUES.includes(tier)) return body
  let parsed
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    return body
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return body
  if (parsed.service_tier !== undefined) return body
  if (models !== undefined && !models.has(parsed.model)) return body
  parsed.service_tier = tier
  return Buffer.from(JSON.stringify(parsed))
}

/**
 * Read one config field. A field marked `.volatile()` is an accessor the loader
 * updates in place, so `.get()` is what yields the current value; plain configs
 * (tests, non-volatile callers) still read directly.
 */
function live(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function'
    ? value.get()
    : value
}

/** Validate a user-supplied API baseURL for the relay. */
export function validateUpstreamBaseURL(input) {
  if (typeof input !== 'string' || input.length === 0) {
    return { valid: false, reason: 'API baseURL 不能为空' }
  }
  let url
  try {
    url = new URL(input)
  } catch {
    return { valid: false, reason: 'API baseURL 不是合法 URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valid: false, reason: '只接受 http: 或 https:' }
  }
  if (url.username || url.password) {
    return { valid: false, reason: 'URL 中不能包含用户名或密码' }
  }
  if (url.search || url.hash) {
    return { valid: false, reason: 'URL 中不能包含查询参数或片段' }
  }
  if (url.pathname.endsWith('/v1/responses') || url.pathname.endsWith('/v1/chat/completions')) {
    return { valid: false, reason: '请填写 API 根路径，不要包含具体接口地址' }
  }
  const hostname = url.hostname.toLowerCase()
  const isLoopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  if (url.protocol === 'http:' && !isLoopback) {
    return { valid: false, reason: '远程 HTTP 不安全，请使用 HTTPS' }
  }
  if (isLoopback && url.port === String(PORT)) {
    return { valid: false, reason: '不能指向代理自身的监听端口' }
  }
  return { valid: true, url, basePath: normalizeBasePath(url.pathname) }
}

function normalizeBasePath(pathname) {
  // Ensure exactly one trailing slash so appending the API-relative path never
  // collapses or duplicates separators.
  return pathname.endsWith('/') ? pathname : pathname + '/'
}

/**
 * Build the loopback proxy. Exported so tests can drive this same request
 * handling on an ephemeral port; `apply` is what binds the fixed port.
 */
export function createProxyServer({
  enabled = false,
  models = new Set(),
  upstreamBaseURL = '',
  tier = 'fast',
  config,
  logger,
} = {}) {
  // With `config` the proxy follows the live plugin config: a volatile settings
  // write updates those accessors in place, so the next request sees it without
  // a remount.
  const resolve = () => {
    if (config === undefined) {
      return {
        enabled,
        models: new Set(models),
        upstreamBaseURL,
        tier,
      }
    }
    return {
      enabled: live(config.enabled) === true,
      models: new Set(live(config.models) ?? []),
      upstreamBaseURL: String(live(config.upstreamBaseURL) ?? ''),
      tier: TIER_VALUES.includes(live(config.tier)) ? live(config.tier) : 'fast',
    }
  }

  const server = http.createServer((req, res) => {
    if (typeof req.url !== 'string' || !req.url.startsWith(FORWARD_PREFIX)) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":{"message":"dsh-tokenhub-gptfast: only /v1/ is proxied"}}')
      return
    }

    // Snapshot the whole configuration at request start so in-flight bodies and
    // streams are not retargeted or re-tiered mid-flight.
    const current = resolve()
    const upstreamValidation = validateUpstreamBaseURL(current.upstreamBaseURL)
    if (!upstreamValidation.valid) {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `dsh-tokenhub-gptfast: ${upstreamValidation.reason}` } }))
      return
    }

    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('error', () => res.destroy())
    req.on('end', () => {
      let body = Buffer.concat(chunks)
      if (current.enabled && req.method === 'POST') {
        const pathname = req.url.split('?')[0]
        if (INJECT_PATHS.has(pathname) && body.length > 0) {
          body = injectTier(body, current.models, current.tier)
        }
      }
      forward(req, res, body, upstreamValidation, logger)
    })
  })

  // A listen failure must not crash the boot.
  server.on('error', (error) => {
    logger?.warn?.(
      `dsh-tokenhub-gptfast: 127.0.0.1:${PORT} unavailable (${error.message}); fast tier stays offline`,
    )
  })

  return server
}

function forward(req, res, body, upstreamValidation, logger) {
  const { url, basePath } = upstreamValidation
  // Drop the local /v1/ prefix and append the rest to the configured API root.
  const localSuffix = req.url.slice(FORWARD_PREFIX.length)
  const targetPath = basePath + localSuffix

  // Defend against traversal that escapes either the local prefix or the
  // configured upstream API root after URL construction.
  const target = new URL(targetPath, url)
  const normalizedLocal = req.url.replace(/\/+/g, '/')
  if (!normalizedLocal.startsWith(FORWARD_PREFIX) || !target.pathname.startsWith(basePath.replace(/\/+$/g, ''))) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":{"message":"dsh-tokenhub-gptfast: invalid request path"}}')
    return
  }

  const headers = {
    ...req.headers,
    host: url.host,
    'content-length': body.length,
    'accept-encoding': 'identity',
  }
  delete headers['transfer-encoding']

  const request = (url.protocol === 'https:' ? https : http).request(
    {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port === '' ? undefined : url.port,
      path: target.pathname + target.search,
      method: req.method,
      headers,
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(res)
    },
  )

  request.on('error', (error) => {
    logger?.warn?.(`dsh-tokenhub-gptfast: upstream error: ${error.message}`)
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end('{"error":{"message":"dsh-tokenhub-gptfast upstream error"}}')
  })
  request.end(body.length > 0 ? body : undefined)
}

export function apply(ctx, config) {
  // The host logger has no console transport in this build, so mirror every line
  // to stderr: an operator must see both the mount and a port conflict.
  const log = {
    info: (message) => {
      ctx.logger?.info?.(message)
      console.error(message)
    },
    warn: (message) => {
      ctx.logger?.warn?.(message)
      console.error(message)
    },
  }
  const server = createProxyServer({ config, logger: log })

  // Registered synchronously on purpose: an effect created after an await is
  // rejected with "cannot create effect on inactive context" and crashes the boot.
  ctx.effect(() => {
    server.listen(PORT, '127.0.0.1', () => {
      const models = live(config?.models) ?? []
      const enabled = live(config?.enabled) === true
      const upstreamBaseURL = live(config?.upstreamBaseURL) ?? ''
      const tier = TIER_VALUES.includes(live(config?.tier)) ? live(config?.tier) : 'fast'
      log.info(
        `dsh-tokenhub-gptfast: listening on 127.0.0.1:${PORT}; ` +
          `the route baseURL must be http://127.0.0.1:${PORT}/v1 ` +
          `(enabled: ${enabled}, tier: ${tier}, ` +
          `models: ${models.length > 0 ? models.join(', ') : 'none'}, ` +
          `upstream: ${upstreamBaseURL || 'not configured'})`,
      )
    })
    return () => server.close()
  }, 'dsh-tokenhub-gptfast: loopback proxy')
}
