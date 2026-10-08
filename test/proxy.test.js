import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

const quiet = { info() {}, warn() {} }
const MODELS = ['gpt-6.1-sol']

/** Stub upstream. Records every request it receives. */
function startStub(handler) {
  const seen = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      seen.push({ method: req.method, url: req.url, headers: req.headers, body })
      handler(req, res, body)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port }))
  })
}

/** Proxy on an ephemeral port. `query` forces a fresh module instance. */
async function startProxy({ upstreamBaseURL, enabled = false, models = MODELS, tier = 'fast', config, query = '' } = {}) {
  const mod = await import(`../lib/index.js${query}`)
  const server = mod.createProxyServer({ enabled, models: new Set(models), upstreamBaseURL, tier, config, logger: quiet })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port, mod }
}

function send(port, { path = '/v1/responses', method = 'POST', body = '', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }),
      )
    })
    req.on('error', reject)
    req.end(body)
  })
}

const okStub = (req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end('{"ok":true}')
}

test('injects the tier for a whitelisted model on responses', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1`, enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const sent = { model: 'gpt-6.1-sol', stream: true }
  const response = await send(proxy.port, { body: JSON.stringify(sent), headers: { 'content-type': 'application/json' } })

  assert.equal(response.status, 200)
  assert.equal(stub.seen.length, 1)
  assert.equal(stub.seen[0].method, 'POST')
  assert.equal(stub.seen[0].url, '/v1/responses')
  assert.deepEqual(JSON.parse(stub.seen[0].body.toString('utf8')), { ...sent, service_tier: 'fast' })
})

test('injects the tier for a whitelisted model on chat completions', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1`, enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const sent = { model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'hi' }], stream: true }
  const response = await send(proxy.port, { path: '/v1/chat/completions', body: JSON.stringify(sent), headers: { 'content-type': 'application/json' } })

  assert.equal(response.status, 200)
  assert.equal(stub.seen.length, 1)
  assert.equal(stub.seen[0].url, '/v1/chat/completions')
  const body = JSON.parse(stub.seen[0].body.toString('utf8'))
  assert.equal(body.service_tier, 'fast')
  assert.ok(Array.isArray(body.messages))
})

test('injects priority tier when configured', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1`, enabled: true, tier: 'priority' })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  await send(proxy.port, { body: JSON.stringify({ model: 'gpt-6.1-sol' }), headers: { 'content-type': 'application/json' } })
  assert.equal(JSON.parse(stub.seen[0].body.toString('utf8')).service_tier, 'priority')
})

test('preserves custom path prefix and query strings', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/gateway/openai/v1`, enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  await send(proxy.port, { path: '/v1/responses?trace=1', body: JSON.stringify({ model: 'gpt-6.1-sol' }), headers: { 'content-type': 'application/json' } })
  assert.equal(stub.seen[0].url, '/gateway/openai/v1/responses?trace=1')
})

test('normalizes trailing slash on baseURL', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1/`, enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  await send(proxy.port, { path: '/v1/chat/completions', body: JSON.stringify({ model: 'gpt-6.1-sol' }), headers: { 'content-type': 'application/json' } })
  assert.equal(stub.seen[0].url, '/v1/chat/completions')
})

test('does not auto-append /v1 when baseURL lacks it', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/openai`, enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  await send(proxy.port, { path: '/v1/models', method: 'GET' })
  assert.equal(stub.seen[0].url, '/openai/models')
})

test('passes a model outside the whitelist through unchanged', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1`, enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const raw = JSON.stringify({ model: 'kimi-k2.7-code' })
  await send(proxy.port, { body: raw, headers: { 'content-type': 'application/json' } })

  assert.equal(stub.seen[0].body.toString('utf8'), raw)
})

test('passes a non-JSON body through unchanged', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1`, enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const raw = 'model=gpt-6.1-sol&broken'
  await send(proxy.port, { body: raw, headers: { 'content-type': 'text/plain' } })

  assert.equal(stub.seen[0].body.toString('utf8'), raw)
})

test('keeps an explicit service_tier', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1`, enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  await send(proxy.port, { body: JSON.stringify({ model: 'gpt-6.1-sol', service_tier: 'default' }), headers: { 'content-type': 'application/json' } })

  assert.equal(JSON.parse(stub.seen[0].body.toString('utf8')).service_tier, 'default')
})

test('does not inject on non-POST generation endpoints', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1`, enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  // GET requests carry no body; verify the request is forwarded without injection.
  await send(proxy.port, { method: 'GET', headers: { 'content-type': 'application/json' } })

  assert.equal(stub.seen.length, 1)
  assert.equal(stub.seen[0].method, 'GET')
  assert.equal(stub.seen[0].url, '/v1/responses')
})

test('does not inject on sub-paths of generation endpoints', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1`, enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const raw = JSON.stringify({ model: 'gpt-6.1-sol' })
  await send(proxy.port, { path: '/v1/responses/compact', body: raw, headers: { 'content-type': 'application/json' } })
  await send(proxy.port, { path: '/v1/responses-other', body: raw, headers: { 'content-type': 'application/json' } })

  assert.equal(stub.seen[0].body.toString('utf8'), raw)
  assert.equal(stub.seen[1].body.toString('utf8'), raw)
})

test('injects nothing while disabled', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1`, enabled: false })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const raw = JSON.stringify({ model: 'gpt-6.1-sol' })
  const response = await send(proxy.port, { body: raw, headers: { 'content-type': 'application/json' } })

  assert.equal(response.status, 200)
  assert.equal(stub.seen[0].body.toString('utf8'), raw)
})

test('rejects missing or invalid upstream configuration', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const missing = await send(proxy.port, { body: '{}', headers: { authorization: 'Bearer secret' } })
  assert.equal(missing.status, 503)
  assert.equal(stub.seen.length, 0)
  assert.ok(!missing.text.includes('secret'))

  const invalid = await send(proxy.port, { path: '/v1/responses', body: '{}', headers: { 'content-type': 'application/json' } })
  assert.equal(invalid.status, 503)
  assert.equal(stub.seen.length, 0)
})

test('follows a live volatile config without a remount', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  let enabled = false
  let upstreamBaseURL = `http://127.0.0.1:${stub.port}/v1`
  let models = ['gpt-6.1-sol']
  let tier = 'fast'
  const config = {
    enabled: { get: () => enabled },
    upstreamBaseURL: { get: () => upstreamBaseURL },
    models: { get: () => models },
    tier: { get: () => tier },
  }
  const proxy = await startProxy({ config })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const raw = JSON.stringify({ model: 'gpt-6.1-sol', stream: true })
  await send(proxy.port, { body: raw, headers: { 'content-type': 'application/json' } })
  assert.equal(stub.seen[0].body.toString('utf8'), raw)

  enabled = true
  await send(proxy.port, { body: raw, headers: { 'content-type': 'application/json' } })
  assert.equal(JSON.parse(stub.seen[1].body.toString('utf8')).service_tier, 'fast')

  models.length = 0
  await send(proxy.port, { body: raw, headers: { 'content-type': 'application/json' } })
  assert.equal(stub.seen[2].body.toString('utf8'), raw)

  tier = 'priority'
  models.push('gpt-6.1-sol')
  await send(proxy.port, { body: raw, headers: { 'content-type': 'application/json' } })
  assert.equal(JSON.parse(stub.seen[3].body.toString('utf8')).service_tier, 'priority')
})

test('requests use the snapshot from request start', { timeout: 5000 }, async (t) => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const stub = await startStub(async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: first\n\n')
    await gate
    res.write('data: second\n\n')
    res.end()
  })
  let upstreamBaseURL = `http://127.0.0.1:${stub.port}/v1`
  const config = {
    enabled: { get: () => true },
    upstreamBaseURL: { get: () => upstreamBaseURL },
    models: { get: () => ['gpt-6.1-sol'] },
    tier: { get: () => 'fast' },
  }
  const proxy = await startProxy({ config })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const first = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: proxy.port, path: '/v1/responses', method: 'POST', headers: { 'content-type': 'application/json' } },
      (res) => {
        res.once('data', (chunk) => {
          // Change the upstream target while the first response is still open.
          upstreamBaseURL = 'http://127.0.0.1:1/v1'
          resolve(chunk.toString('utf8'))
        })
      },
    )
    req.on('error', reject)
    req.end(JSON.stringify({ model: 'gpt-6.1-sol' }))
  })

  assert.match(first, /first/)
  release()

  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(stub.seen.length, 1)
  assert.equal(stub.seen[0].url, '/v1/responses')
})

test('refuses paths outside /v1/', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1` })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const response = await send(proxy.port, { path: '/admin', method: 'GET' })

  assert.equal(response.status, 404)
  assert.equal(stub.seen.length, 0)
})

test('rejects path traversal that leaves the allowed prefix', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1` })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const response = await send(proxy.port, { path: '/v1/../../evil', body: '{}' })

  assert.equal(response.status, 404)
  assert.equal(stub.seen.length, 0)
})

test('never retargets the host', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1` })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const refused = await send(proxy.port, { path: '//evil.example/v1/responses', body: '{}' })
  assert.equal(refused.status, 404)
  assert.equal(stub.seen.length, 0)
})

test('streams response chunks without buffering', { timeout: 5000 }, async (t) => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const stub = await startStub(async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: first\n\n')
    await gate
    res.write('data: second\n\n')
    res.end()
  })
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1`, enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const first = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxy.port, path: '/v1/responses', method: 'POST' }, (res) => {
      res.once('data', (chunk) => resolve(chunk.toString('utf8')))
    })
    req.on('error', reject)
    req.end(JSON.stringify({ model: 'gpt-6.1-sol', stream: true }))
  })

  assert.match(first, /first/)
  release()
})

test('forwards the authorization header unchanged', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1` })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  await send(proxy.port, { body: '{}', headers: { authorization: 'Bearer test-key' } })

  assert.equal(stub.seen[0].headers.authorization, 'Bearer test-key')
  assert.equal(stub.seen[0].headers['accept-encoding'], 'identity')
  assert.equal(stub.seen[0].headers.host, `127.0.0.1:${stub.port}`)
})

test('passes upstream errors through unchanged', { timeout: 5000 }, async (t) => {
  const stub = await startStub((req, res) => {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end('{"error":{"code":"unsupported_tier"}}')
  })
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1`, enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const response = await send(proxy.port, { body: JSON.stringify({ model: 'gpt-6.1-sol' }), headers: { 'content-type': 'application/json' } })

  assert.equal(response.status, 400)
  assert.equal(stub.seen.length, 1)
  assert.equal(JSON.parse(response.text).error.code, 'unsupported_tier')
})

test('does not follow upstream redirects', { timeout: 5000 }, async (t) => {
  const stub = await startStub((req, res) => {
    res.writeHead(302, { location: 'http://elsewhere.example/v1/responses' })
    res.end()
  })
  const proxy = await startProxy({ upstreamBaseURL: `http://127.0.0.1:${stub.port}/v1`, enabled: true })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const response = await send(proxy.port, { body: JSON.stringify({ model: 'gpt-6.1-sol' }), headers: { 'content-type': 'application/json' } })

  assert.equal(response.status, 302)
  assert.equal(stub.seen.length, 1)
  assert.equal(stub.seen[0].url, '/v1/responses')
})

test('apply registers its effect synchronously', { timeout: 5000 }, async () => {
  const mod = await import('../lib/index.js?apply-shape')
  let registered = false
  const ctx = {
    logger: quiet,
    effect(callback, label) {
      registered = true
      assert.equal(typeof callback, 'function')
      assert.equal(typeof label, 'string')
      return () => {}
    },
  }

  mod.apply(ctx, {
    enabled: { get: () => false },
    upstreamBaseURL: { get: () => '' },
    models: { get: () => ['gpt-6.1-sol'] },
    tier: { get: () => 'fast' },
  })

  assert.equal(registered, true)
})
