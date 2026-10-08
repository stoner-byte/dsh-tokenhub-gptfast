import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, injectTier } from '../lib/index.js'

const parse = (buffer) => JSON.parse(buffer.toString('utf8'))
const json = (value) => Buffer.from(JSON.stringify(value))

test('adds service_tier to a Responses body', () => {
  const injected = parse(injectTier(json({ model: 'gpt-6.1-sol', stream: true })))
  assert.equal(injected.service_tier, 'fast')
  assert.equal(injected.model, 'gpt-6.1-sol')
  assert.equal(injected.stream, true)
})

test('keeps an explicit service_tier', () => {
  for (const tier of ['default', 'bogus']) {
    const injected = parse(injectTier(json({ model: 'gpt-6.1-sol', service_tier: tier })))
    assert.equal(injected.service_tier, tier)
  }
})

test('returns non-JSON bytes untouched', () => {
  const body = Buffer.from('not json at all')
  assert.equal(injectTier(body), body)
})

test('returns arrays and scalars untouched', () => {
  for (const raw of ['[1,2]', '"text"', '42', 'null']) {
    const body = Buffer.from(raw)
    assert.equal(injectTier(body), body, raw)
  }
})

test('skips models outside the whitelist', () => {
  const models = new Set(['gpt-6.1-sol'])
  const body = json({ model: 'kimi-k2.7-code' })
  assert.equal(injectTier(body, models), body)
  assert.equal(parse(injectTier(json({ model: 'gpt-6.1-sol' }), models)).service_tier, 'fast')
})

test('Config defaults are the documented ones', () => {
  const config = Config({})
  assert.equal(config.enabled.get(), true)
  assert.deepEqual(config.models.get(), ['gpt-6-sol', 'gpt-6.1-sol'])
})

// Without `meta.volatile` the Host settings form skips these fields, so the
// Plugins page would show no switch and no namespace at all.
test('Config fields are volatile, so the Host can edit them at runtime', () => {
  assert.equal(Config.dict.enabled.meta.volatile, true)
  assert.equal(Config.dict.models.meta.volatile, true)
})
