// Browser half: the Plugins page renders this cell as the row's Configure page
// and passes the Host-owned form for that entry. The form exists only because
// `Config` marks its fields `.volatile()`.
window.__ModuleLoader__.load({
  id: 'dsh-tokenhub-gptfast',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'gptFast'
    const ROW_KEY = 'dsh-tokenhub-gptfast#dsh-tokenhub-gptfast'

    const zh = {
      title: 'GPT 快速档（中转站）',
      on: '已开启',
      off: '已关闭',
      enabled: '请求快速档',
      enabledHint: '关闭后代理继续转发，只是不再注入 service_tier。',
      upstreamBaseURL: '中转站 API baseURL',
      upstreamBaseURLHint: '例如 https://relay.example/v1。认证头会发送给这个目标，请确认你信任它。',
      upstreamBaseURLError: '请填写合法的 API 根路径',
      models: '注入的模型',
      modelsHint: '一行一个模型名，留空表示不注入。',
      tier: '请求档位',
      tierHint: '一个中转站统一使用这个档位。',
      save: '保存',
      saved: '已保存',
      reset: '恢复默认',
      missing: '这个条目没有可编辑的配置。',
    }
    const en = {
      title: 'GPT fast tier (relay)',
      on: 'on',
      off: 'off',
      enabled: 'Request fast tier',
      enabledHint: 'When off the proxy keeps forwarding but stops injecting service_tier.',
      upstreamBaseURL: 'Relay API baseURL',
      upstreamBaseURLHint: 'e.g. https://relay.example/v1. The authorization header will be sent to this target; make sure you trust it.',
      upstreamBaseURLError: 'Enter a valid API base path',
      models: 'Injected models',
      modelsHint: 'One model name per line; empty means none.',
      tier: 'Requested tier',
      tierHint: 'One tier for the whole relay.',
      save: 'Save',
      saved: 'Saved',
      reset: 'Restore defaults',
      missing: 'This entry exposes no editable configuration.',
    }

    const box = { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '560px' }
    const row = { display: 'flex', flexDirection: 'column', gap: '4px' }
    const label = { color: 'var(--dsw-alias-label-primary)', fontSize: '13px' }
    const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', margin: 0 }
    const errorStyle = { color: 'var(--dsw-alias-error)', fontSize: '12px', margin: 0 }
    const input = {
      font: 'inherit',
      fontSize: '13px',
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-bg-layer-1)',
      border: '.5px solid var(--dsw-alias-border-l4)',
      borderRadius: 'var(--dsw-radius-md)',
      padding: '6px 8px',
    }
    const area = {
      ...input,
      resize: 'vertical',
    }
    const select = {
      ...input,
      height: '28px',
    }
    const button = {
      font: 'inherit',
      fontSize: '13px',
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-bg-layer-1)',
      border: '.5px solid var(--dsw-alias-border-l3)',
      borderRadius: 'var(--dsw-radius-md)',
      padding: '0 12px',
      height: '28px',
      cursor: 'pointer',
      alignSelf: 'flex-start',
    }

    // Bound to the locale service in `apply`; `translate` reads the active
    // locale on every call, so switching language needs no re-registration.
    let translate = (key) => (en[key] === undefined ? key : en[key])

    function FastTierConfig(props) {
      const [draft, setDraft] = React.useState(() => ({ upstreamBaseURL: null, models: null, tier: null }))
      const [notice, setNotice] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const form = props.form
      const state = form === undefined ? undefined : form.state
      const value = (state && state.value) || {}
      const models = Array.isArray(value.models) ? value.models : []
      const tier = value.tier === 'priority' ? 'priority' : 'fast'
      const upstreamBaseURL = typeof value.upstreamBaseURL === 'string' ? value.upstreamBaseURL : ''
      const t = translate

      if (props.view === 'summary') return h('span', null, t('title'))
      if (form === undefined) return h('p', { style: hint }, t('missing'))

      const isURLValid = (text) => {
        if (text.length === 0) return false
        try {
          const url = new URL(text)
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
          if (url.username || url.password) return false
          if (url.search || url.hash) return false
          return true
        } catch {
          return false
        }
      }

      const write = (ops) => {
        setNotice(null)
        setError(null)
        return form
          .mutate(ops, state.revision)
          .then(() => setNotice(t('saved')))
          .catch((err) => setError(String((err && err.message) || err)))
      }

      const lines = (text) => text.split(/[\n,]/).map((item) => item.trim()).filter((item) => item !== '')

      const saveDraft = () => {
        if (saving) return
        const urlDraft = draft.upstreamBaseURL === null ? upstreamBaseURL : draft.upstreamBaseURL
        const modelsDraft = draft.models === null ? models : lines(draft.models)
        const tierDraft = draft.tier === null ? tier : draft.tier
        if (!isURLValid(urlDraft)) {
          setError(t('upstreamBaseURLError'))
          return
        }
        setSaving(true)
        write([
          { op: 'set', path: ['upstreamBaseURL'], value: urlDraft },
          { op: 'set', path: ['models'], value: modelsDraft },
          { op: 'set', path: ['tier'], value: tierDraft },
        ]).finally(() => setSaving(false))
      }

      const resetDefaults = () => {
        setNotice(null)
        setError(null)
        // Preserve upstreamBaseURL; reset only the fast-tier behavior fields.
        write([
          { op: 'unset', path: ['enabled'] },
          { op: 'unset', path: ['models'] },
          { op: 'unset', path: ['tier'] },
        ])
          .then(() => setDraft({ upstreamBaseURL: null, models: null, tier: null }))
          .catch(() => {})
      }

      return h('div', { style: box },
        h('div', { style: row },
          h('label', { style: label },
            h('input', {
              type: 'checkbox',
              checked: value.enabled === true,
              onChange: (event) => write([{ op: 'set', path: ['enabled'], value: event.target.checked }]),
            }),
            ' ' + t('enabled'),
          ),
          h('p', { style: hint }, t('enabledHint')),
        ),
        h('div', { style: row },
          h('label', { style: label, htmlFor: 'gptfast-upstreamBaseURL' }, t('upstreamBaseURL')),
          h('input', {
            id: 'gptfast-upstreamBaseURL',
            style: input,
            type: 'url',
            spellCheck: false,
            value: draft.upstreamBaseURL === null ? upstreamBaseURL : draft.upstreamBaseURL,
            onChange: (event) => setDraft((prev) => ({ ...prev, upstreamBaseURL: event.target.value })),
            onKeyDown: (event) => { if (event.key === 'Enter') saveDraft() },
          }),
          h('p', { style: hint }, t('upstreamBaseURLHint')),
        ),
        h('div', { style: row },
          h('label', { style: label, htmlFor: 'gptfast-tier' }, t('tier')),
          h('select', {
            id: 'gptfast-tier',
            style: select,
            value: draft.tier === null ? tier : draft.tier,
            onChange: (event) => setDraft((prev) => ({ ...prev, tier: event.target.value })),
          }, [
            h('option', { value: 'fast', key: 'fast' }, 'fast'),
            h('option', { value: 'priority', key: 'priority' }, 'priority'),
          ]),
          h('p', { style: hint }, t('tierHint')),
        ),
        h('div', { style: row },
          h('label', { style: label, htmlFor: 'gptfast-models' }, t('models')),
          h('textarea', {
            id: 'gptfast-models',
            style: area,
            rows: 4,
            spellCheck: false,
            value: draft.models === null ? models.join('\n') : draft.models,
            onChange: (event) => setDraft((prev) => ({ ...prev, models: event.target.value })),
          }),
          h('p', { style: hint }, t('modelsHint')),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            h('button', {
              style: button,
              disabled: saving,
              onClick: saveDraft,
            }, t('save')),
            h('button', {
              style: button,
              onClick: resetDefaults,
            }, t('reset')),
            error !== null ? h('span', { style: errorStyle, role: 'alert' }, error) : null,
            notice === null ? null : h('span', { style: hint }, notice),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-tokenhub-gptfast: dictionaries')
        translate = ctx.locale.bind(NS)
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: ROW_KEY,
        }, FastTierConfig))
      },
    }
  },
})
