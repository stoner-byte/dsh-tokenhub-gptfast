// Browser half: the Plugins page renders this cell as the `tokenhub-fast-proxy`
// row's Configure page and passes the Host-owned form for that entry. The form
// exists only because `Config` marks its fields `.volatile()`.
window.__ModuleLoader__.load({
  id: 'dsh-tokenhub-fast',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'tokenhubFast'
    const ROW_KEY = 'dsh-tokenhub-fast#tokenhub-fast-proxy'

    const zh = {
      title: 'TokenHub 快速档',
      on: '已开启',
      off: '已关闭',
      enabled: '开启快速档',
      enabledHint: '关闭后代理继续转发，只是不再注入 service_tier。',
      models: '注入的模型',
      modelsHint: '一行一个模型名，留空表示不注入。',
      save: '保存模型列表',
      saved: '已保存',
      reset: '恢复默认',
      missing: '这个条目没有可编辑的配置。',
    }
    const en = {
      title: 'TokenHub fast tier',
      on: 'on',
      off: 'off',
      enabled: 'Fast tier',
      enabledHint: 'When off the proxy keeps forwarding but stops injecting service_tier.',
      models: 'Injected models',
      modelsHint: 'One model name per line; empty means none.',
      save: 'Save model list',
      saved: 'Saved',
      reset: 'Restore defaults',
      missing: 'This entry exposes no editable configuration.',
    }

    const box = { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '560px' }
    const row = { display: 'flex', flexDirection: 'column', gap: '4px' }
    const label = { color: 'var(--dsw-alias-label-primary)', fontSize: '13px' }
    const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', margin: 0 }
    const area = {
      font: 'inherit',
      fontSize: '13px',
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-bg-layer-1)',
      border: '.5px solid var(--dsw-alias-border-l4)',
      borderRadius: 'var(--dsw-radius-md)',
      padding: '6px 8px',
      resize: 'vertical',
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
      const [draft, setDraft] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const form = props.form
      const state = form === undefined ? undefined : form.state
      const value = (state && state.value) || {}
      const models = Array.isArray(value.models) ? value.models : []
      const t = translate

      if (props.view === 'summary') return h('span', null, value.enabled === false ? t('off') : t('on'))
      if (form === undefined) return h('p', { style: hint }, t('missing'))

      const write = (ops) => {
        setNotice(null)
        return form
          .mutate(ops, state.revision)
          .then(() => setNotice(t('saved')))
          .catch((error) => setNotice(String((error && error.message) || error)))
      }
      const lines = (text) => text.split(/[\n,]/).map((item) => item.trim()).filter((item) => item !== '')

      return h('div', { style: box },
        h('div', { style: row },
          h('label', { style: label },
            h('input', {
              type: 'checkbox',
              checked: value.enabled !== false,
              onChange: (event) => write([{ op: 'set', path: ['enabled'], value: event.target.checked }]),
            }),
            ' ' + t('enabled'),
          ),
          h('p', { style: hint }, t('enabledHint')),
        ),
        h('div', { style: row },
          h('span', { style: label }, t('models')),
          h('textarea', {
            style: area,
            rows: 4,
            spellCheck: false,
            value: draft === null ? models.join('\n') : draft,
            onChange: (event) => setDraft(event.target.value),
          }),
          h('p', { style: hint }, t('modelsHint')),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            h('button', {
              style: button,
              onClick: () => write([{ op: 'set', path: ['models'], value: lines(draft === null ? models.join('\n') : draft) }]),
            }, t('save')),
            h('button', {
              style: button,
              onClick: () => write([{ op: 'unset', path: ['enabled'] }, { op: 'unset', path: ['models'] }]),
            }, t('reset')),
            notice === null ? null : h('span', { style: hint }, notice),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-tokenhub-fast: dictionaries')
        translate = ctx.locale.bind(NS)
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: ROW_KEY,
        }, FastTierConfig))
      },
    }
  },
})
