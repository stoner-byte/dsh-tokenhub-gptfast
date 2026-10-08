import http from 'node:http'
import https from 'node:https'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-tokenhub-fast'

/**
 * Loopback port. A pi-ai route's `baseURL` is static config and loader patches
 * replace a whole `config`, so the port cannot be picked at runtime.
 */
export const PORT = 8788

/** Tier value TokenHub maps to the upstream `priority` tier. */
const TIER = 'fast'

/** Only this path prefix may carry an injectable body. */
const INJECT_PREFIX = '/v1/responses'

/** Anything outside this prefix is refused instead of forwarded. */
const FORWARD_PREFIX = '/v1/'

/** Upstream host that understands `service_tier`. Overridable for tests only. */
const UPSTREAM = process.env.DSH_TOKENHUB_FAST_UPSTREAM ?? 'https://token.yoso-ai.com'

// `.volatile()` is what makes these two fields editable at runtime: the settings
// form only projects volatile fields, and the loader commits a volatile change
// into the running config without remounting the plugin. Remove it and the
// switch disappears from the Plugins page.
export const Config = z.object({
  enabled: z.boolean().default(true).description('开启 TokenHub 快速档').volatile(),
  models: z
    .array(z.string())
    .default(['gpt-6-sol', 'gpt-6.1-sol'])
    .description('只对这些模型注入 service_tier')
    .volatile(),
})

/**
 * Add the service tier to a Responses request body.
 *
 * Returns the identical buffer whenever the body must not change: not JSON,
 * not a JSON object, an explicit `service_tier`, or a model outside `models`.
 * Pass `models` as undefined to skip the whitelist check.
 */
export function injectTier(body, models) {
  let parsed
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    return body
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return body
  if (parsed.service_tier !== undefined) return body
  if (models !== undefined && !models.has(parsed.model)) return body
  parsed.service_tier = TIER
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

/**
 * Build the loopback proxy. Exported so tests can drive this same request
 * handling on an ephemeral port; `apply` is what binds the fixed port.
 */
export function createProxyServer({
  enabled = true,
  models = new Set(),
  config,
  upstream = UPSTREAM,
  logger,
} = {}) {
  // With `config` the proxy follows the live plugin config: a volatile settings
  // write updates those accessors in place, so the next request sees it without
  // a remount.
  const tier = () =>
    config === undefined
      ? { enabled, models }
      : { enabled: live(config.enabled) !== false, models: new Set(live(config.models) ?? []) }

  const server = http.createServer((req, res) => {
    if (typeof req.url !== 'string' || !req.url.startsWith(FORWARD_PREFIX)) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":{"message":"dsh-tokenhub-fast: only /v1/ is proxied"}}')
      return
    }

    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('error', () => res.destroy())
    req.on('end', () => {
      let body = Buffer.concat(chunks)
      const current = tier()
      if (current.enabled && req.method === 'POST' && req.url.startsWith(INJECT_PREFIX) && body.length > 0) {
        body = injectTier(body, current.models)
      }
      forward(req, res, body, upstream, logger)
    })
  })

  // A listen failure must not crash the boot.
  server.on('error', (error) => {
    logger?.warn?.(
      `dsh-tokenhub-fast: 127.0.0.1:${PORT} unavailable (${error.message}); fast tier stays offline`,
    )
  })

  return server
}

function forward(req, res, body, upstream, logger) {
  // Host always comes from the constant, never from the request line.
  const base = new URL(upstream)
  const target = new URL(req.url, base)
  const headers = {
    ...req.headers,
    host: base.host,
    'content-length': body.length,
    'accept-encoding': 'identity',
  }
  delete headers['transfer-encoding']

  const request = (base.protocol === 'https:' ? https : http).request(
    {
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port === '' ? undefined : base.port,
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
    logger?.warn?.(`dsh-tokenhub-fast: upstream error: ${error.message}`)
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end('{"error":{"message":"dsh-tokenhub-fast upstream error"}}')
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
      const enabled = live(config?.enabled) !== false
      log.info(
        `dsh-tokenhub-fast: listening on 127.0.0.1:${PORT} -> ${UPSTREAM}; ` +
          `the route baseURL must be http://127.0.0.1:${PORT}/v1 ` +
          `(fast ${enabled ? 'on' : 'off'}, models: ${models.length > 0 ? models.join(', ') : 'none'})`,
      )
    })
    return () => server.close()
  }, 'dsh-tokenhub-fast: loopback proxy')
}
