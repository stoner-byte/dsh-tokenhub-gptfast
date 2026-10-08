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
async function startProxy({ upstream, enabled = true, models = MODELS, config, query = '' } = {}) {
  const mod = await import(`../lib/index.js${query}`)
  const server = mod.createProxyServer({ enabled, models: new Set(models), config, upstream, logger: quiet })
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

test('injects the tier for a whitelisted model', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstream: `http://127.0.0.1:${stub.port}` })
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

test('passes a model outside the whitelist through unchanged', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstream: `http://127.0.0.1:${stub.port}` })
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
  const proxy = await startProxy({ upstream: `http://127.0.0.1:${stub.port}` })
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
  const proxy = await startProxy({ upstream: `http://127.0.0.1:${stub.port}` })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  await send(proxy.port, { body: JSON.stringify({ model: 'gpt-6.1-sol', service_tier: 'default' }) })

  assert.equal(JSON.parse(stub.seen[0].body.toString('utf8')).service_tier, 'default')
})

test('injects nothing while disabled', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstream: `http://127.0.0.1:${stub.port}`, enabled: false })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const raw = JSON.stringify({ model: 'gpt-6.1-sol' })
  const response = await send(proxy.port, { body: raw })

  assert.equal(response.status, 200)
  assert.equal(stub.seen[0].body.toString('utf8'), raw)
})

// The Plugins page switch writes the volatile fields; the loader commits them
// into the running accessors, so the next request must already follow them.
test('follows a live volatile config without a remount', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  let enabled = true
  const models = ['gpt-6.1-sol']
  const config = { enabled: { get: () => enabled }, models: { get: () => models } }
  const proxy = await startProxy({ upstream: `http://127.0.0.1:${stub.port}`, config })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const raw = JSON.stringify({ model: 'gpt-6.1-sol', stream: true })
  await send(proxy.port, { body: raw, headers: { 'content-type': 'application/json' } })
  assert.equal(JSON.parse(stub.seen[0].body.toString('utf8')).service_tier, 'fast')

  enabled = false
  await send(proxy.port, { body: raw, headers: { 'content-type': 'application/json' } })
  assert.equal(stub.seen[1].body.toString('utf8'), raw)

  enabled = true
  models.length = 0
  await send(proxy.port, { body: raw, headers: { 'content-type': 'application/json' } })
  assert.equal(stub.seen[2].body.toString('utf8'), raw)
})

test('refuses paths outside /v1/', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstream: `http://127.0.0.1:${stub.port}` })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  const response = await send(proxy.port, { path: '/admin', method: 'GET' })

  assert.equal(response.status, 404)
  assert.equal(stub.seen.length, 0)
})

test('never retargets the host', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  const proxy = await startProxy({ upstream: `http://127.0.0.1:${stub.port}` })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  // A protocol-relative path would resolve to another host, so the /v1/ guard refuses it.
  const refused = await send(proxy.port, { path: '//evil.example/v1/responses', body: '{}' })
  assert.equal(refused.status, 404)
  assert.equal(stub.seen.length, 0)

  // Traversal is normalized, but the connection still goes to the configured upstream.
  await send(proxy.port, { path: '/v1/../../evil', body: '{}' })
  assert.equal(stub.seen.length, 1)
  assert.equal(stub.seen[0].url, '/evil')
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
  const proxy = await startProxy({ upstream: `http://127.0.0.1:${stub.port}` })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  // The first chunk must arrive while the stub still holds the second back.
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
  const proxy = await startProxy({ upstream: `http://127.0.0.1:${stub.port}` })
  t.after(() => {
    stub.server.close()
    proxy.server.close()
  })

  await send(proxy.port, { body: '{}', headers: { authorization: 'Bearer test-key' } })

  assert.equal(stub.seen[0].headers.authorization, 'Bearer test-key')
  assert.equal(stub.seen[0].headers['accept-encoding'], 'identity')
  assert.equal(stub.seen[0].headers.host, `127.0.0.1:${stub.port}`)
})

test('reads the upstream from DSH_TOKENHUB_FAST_UPSTREAM', { timeout: 5000 }, async (t) => {
  const stub = await startStub(okStub)
  process.env.DSH_TOKENHUB_FAST_UPSTREAM = `http://127.0.0.1:${stub.port}`
  t.after(() => {
    stub.server.close()
    delete process.env.DSH_TOKENHUB_FAST_UPSTREAM
  })

  const mod = await import('../lib/index.js?from-env')
  const server = mod.createProxyServer({ models: new Set(MODELS), logger: quiet })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())

  await send(server.address().port, { body: '{}' })

  assert.equal(stub.seen.length, 1)
})

test('a listen failure only warns', { timeout: 5000 }, async (t) => {
  const warnings = []
  const mod = await import('../lib/index.js?port-conflict')
  const first = mod.createProxyServer({ logger: quiet })
  await new Promise((resolve) => first.listen(0, '127.0.0.1', resolve))
  t.after(() => first.close())

  const second = mod.createProxyServer({ logger: { info() {}, warn: (message) => warnings.push(message) } })
  const busy = first.address().port
  await new Promise((resolve) => {
    second.once('error', resolve)
    second.listen(busy, '127.0.0.1')
  })

  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /unavailable/)
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

  mod.apply(ctx, { enabled: true, models: ['gpt-6.1-sol'] })

  assert.equal(registered, true)
})
