import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, injectTier, validateUpstreamBaseURL, TIER_VALUES } from '../lib/index.js'

const parse = (buffer) => JSON.parse(buffer.toString('utf8'))
const json = (value) => Buffer.from(JSON.stringify(value))

test('adds service_tier to a Responses body', () => {
  const injected = parse(injectTier(json({ model: 'gpt-6.1-sol', stream: true }), undefined, 'fast'))
  assert.equal(injected.service_tier, 'fast')
  assert.equal(injected.model, 'gpt-6.1-sol')
  assert.equal(injected.stream, true)
})

test('keeps an explicit service_tier', () => {
  for (const tier of ['default', 'bogus']) {
    const injected = parse(injectTier(json({ model: 'gpt-6.1-sol', service_tier: tier }), undefined, 'fast'))
    assert.equal(injected.service_tier, tier)
  }
})

test('returns non-JSON bytes untouched', () => {
  const body = Buffer.from('not json at all')
  assert.equal(injectTier(body, undefined, 'fast'), body)
})

test('returns arrays and scalars untouched', () => {
  for (const raw of ['[1,2]', '"text"', '42', 'null']) {
    const body = Buffer.from(raw)
    assert.equal(injectTier(body, undefined, 'fast'), body, raw)
  }
})

test('skips models outside the whitelist', () => {
  const models = new Set(['gpt-6.1-sol'])
  const body = json({ model: 'kimi-k2.7-code' })
  assert.equal(injectTier(body, models, 'fast'), body)
  assert.equal(parse(injectTier(json({ model: 'gpt-6.1-sol' }), models, 'fast')).service_tier, 'fast')
})

test('injects priority when configured', () => {
  const models = new Set(['gpt-6.1-sol'])
  const injected = parse(injectTier(json({ model: 'gpt-6.1-sol' }), models, 'priority'))
  assert.equal(injected.service_tier, 'priority')
})

test('ignores invalid tier values', () => {
  const models = new Set(['gpt-6.1-sol'])
  const body = json({ model: 'gpt-6.1-sol' })
  assert.equal(injectTier(body, models, 'ultrafast'), body)
  assert.equal(injectTier(body, models, undefined), body)
})

test('does not require gpt in the model name', () => {
  const models = new Set(['team-coder'])
  const injected = parse(injectTier(json({ model: 'team-coder' }), models, 'fast'))
  assert.equal(injected.service_tier, 'fast')
})

test('empty whitelist means no injection', () => {
  const models = new Set()
  const body = json({ model: 'gpt-6.1-sol' })
  assert.equal(injectTier(body, models, 'fast'), body)
})

test('Config defaults are the documented ones', () => {
  const config = Config({})
  assert.equal(config.enabled.get(), false)
  assert.deepEqual(config.models.get(), ['gpt-6-sol', 'gpt-6.1-sol'])
  assert.equal(config.tier.get(), 'fast')
  assert.equal(config.upstreamBaseURL.get(), '')
})

// Without `meta.volatile` the Host settings form skips these fields, so the
// Plugins page would show no switch and no namespace at all.
test('Config fields are volatile, so the Host can edit them at runtime', () => {
  assert.equal(Config.dict.enabled.meta.volatile, true)
  assert.equal(Config.dict.models.meta.volatile, true)
  assert.equal(Config.dict.tier.meta.volatile, true)
  assert.equal(Config.dict.upstreamBaseURL.meta.volatile, true)
})

const validBaseURL = (input) => {
  const result = validateUpstreamBaseURL(input)
  return result.valid
}

test('validates absolute HTTPS baseURLs without credentials or search', () => {
  assert.ok(validBaseURL('https://relay.example/v1'))
  assert.ok(validBaseURL('https://relay.example/gateway/openai/v1/'))
  assert.ok(validBaseURL('https://relay.example/openai'))
})

test('rejects loopback HTTP pointing at the proxy itself', () => {
  assert.ok(!validBaseURL('http://127.0.0.1:8788/v1'))
  assert.ok(!validBaseURL('http://localhost:8788/v1'))
  assert.ok(!validBaseURL('http://[::1]:8788/v1'))
})

test('allows loopback HTTP for local stub tests', () => {
  assert.ok(validBaseURL('http://127.0.0.1:9999/v1'))
  assert.ok(validBaseURL('http://localhost:9999/v1'))
})

test('rejects remote HTTP, credentials, search, hash and concrete endpoints', () => {
  assert.ok(!validBaseURL('http://relay.example/v1'))
  assert.ok(!validBaseURL('https://user:pass@relay.example/v1'))
  assert.ok(!validBaseURL('https://relay.example/v1?key=abc'))
  assert.ok(!validBaseURL('https://relay.example/v1#anchor'))
  assert.ok(!validBaseURL('https://relay.example/v1/responses'))
  assert.ok(!validBaseURL('https://relay.example/v1/chat/completions'))
})

test('rejects empty or malformed URLs', () => {
  assert.ok(!validBaseURL(''))
  assert.ok(!validBaseURL('not-a-url'))
  assert.ok(!validBaseURL('/v1'))
})

test('TIER_VALUES contains only expected tiers', () => {
  assert.deepEqual(TIER_VALUES, ['fast', 'priority'])
})
