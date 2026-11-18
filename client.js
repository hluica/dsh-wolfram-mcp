/**
 * Client half of the Wolfram MCP plugin.
 *
 * Adds one page under Settings → Wolfram MCP. The page reads the owner-only
 * Host API, shows the persisted kernel-generated configuration in a read-only
 * textarea, and lets the user request one fresh fetch.
 *
 * @module @local/dsh-wolfram-mcp/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-wolfram-mcp',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'settings.wolframMcp'
    const SECTION_ID = 'wolfram-mcp'
    const SECTION_ORDER = 22
    const API = '/dsh-wolfram-mcp/api'

    const zh = {
      'section.label': 'Wolfram MCP',
      title: 'Wolfram MCP 服务器',
      desc: '查看当前持久化的 Wolfram MCP 配置，并在需要时重新从 Wolfram kernel 获取。MCP 服务器由插件自动注册。',
      'status.title': '状态',
      source: '配置来源',
      'source.initial': '首次安装',
      'source.manual': '手动刷新',
      'source.none': '尚未获取',
      fetchedAt: '最近获取',
      attemptedAt: '最近尝试',
      never: '从未',
      statePath: '状态文件',
      wolframscript: 'WolframScript',
      wolframApp: 'Wolfram App',
      notFound: '未找到',
      persisted: '持久化',
      'persisted.yes': '已写入',
      'persisted.no': '写入失败',
      lastError: '最近错误',
      'config.title': '当前 MCP 配置',
      'config.hint': '此区域只读。内容来自 Wolfram kernel 的 JSONConfiguration 输出。',
      'config.empty': '尚未获取配置。',
      refresh: '重新获取配置',
      refreshing: '正在获取…',
      refreshHint: '重新获取会运行 wolframscript，成功后覆盖本地持久化配置并重新注册 MCP 服务器。',
      'mcp.title': 'MCP 服务器',
      'mcp.empty': '当前没有已注册的 MCP 服务器。',
      'mcp.connecting': '连接中',
      'mcp.connected': '已连接',
      'mcp.reconnecting': '重连中',
      'mcp.failed': '失败',
      'mcp.waiting': '等待凭据',
      'mcp.closed': '已关闭',
      'mcp.disabled': '已禁用',
      'mcp.tools': '工具数',
      'mcp.registeredAt': '注册时间',
      'skills.title': 'Wolfram Agent Skills',
      'skills.root': '全局 Skills 目录',
      'skills.none': '未复制任何 skill。',
      'skills.installed': '已复制',
      'skills.skipped': '已跳过',
      'skills.error': '复制错误',
      registrationErrors: '注册错误',
      requestFailed: '请求失败',
      loading: '正在读取状态…',
      'toast.scanning': '正在检测 Wolfram 安装并获取 MCP 配置。首次运行可能需要一些时间，请稍候…',
      'toast.mcpStarting': 'Wolfram MCP 首次启动，正在下载/加载数据，可能需要数分钟。完成后此提示会自动消失。',
    }

    const en = {
      'section.label': 'Wolfram MCP',
      title: 'Wolfram MCP server',
      desc: 'Inspect the persisted Wolfram MCP configuration and request a fresh copy from the Wolfram kernel when needed. The MCP server is registered by this plugin.',
      'status.title': 'Status',
      source: 'Configuration source',
      'source.initial': 'First install',
      'source.manual': 'Manual refresh',
      'source.none': 'Not fetched yet',
      fetchedAt: 'Last fetched',
      attemptedAt: 'Last attempt',
      never: 'Never',
      statePath: 'State file',
      wolframscript: 'WolframScript',
      wolframApp: 'Wolfram App',
      notFound: 'Not found',
      persisted: 'Persisted',
      'persisted.yes': 'Written',
      'persisted.no': 'Write failed',
      lastError: 'Last error',
      'config.title': 'Current MCP configuration',
      'config.hint': 'Read-only. The content comes from the Wolfram kernel JSONConfiguration output.',
      'config.empty': 'No configuration has been fetched yet.',
      refresh: 'Fetch configuration again',
      refreshing: 'Fetching…',
      refreshHint: 'Fetching runs wolframscript, then replaces the persisted configuration and re-registers the MCP server on success.',
      'mcp.title': 'MCP servers',
      'mcp.empty': 'No MCP server is currently registered.',
      'mcp.connecting': 'Connecting',
      'mcp.connected': 'Connected',
      'mcp.reconnecting': 'Reconnecting',
      'mcp.failed': 'Failed',
      'mcp.waiting': 'Waiting for credentials',
      'mcp.closed': 'Closed',
      'mcp.disabled': 'Disabled',
      'mcp.tools': 'Tools',
      'mcp.registeredAt': 'Registered',
      'skills.title': 'Wolfram Agent Skills',
      'skills.root': 'Global skills root',
      'skills.none': 'No skill was copied.',
      'skills.installed': 'Copied',
      'skills.skipped': 'Skipped',
      'skills.error': 'Copy error',
      registrationErrors: 'Registration errors',
      requestFailed: 'Request failed',
      loading: 'Reading state…',
      'toast.scanning': 'Detecting the Wolfram installation and fetching the MCP configuration. This may take a while on first run…',
      'toast.mcpStarting': 'Wolfram MCP is starting for the first time and downloading/loading data. This may take several minutes; the notice disappears when it is ready.',
    }

    /**
     * Call one owner-only API endpoint.
     * @param {string} path - path under the API prefix.
     * @param {RequestInit} [init] - fetch options.
     * @returns {Promise<Record<string, unknown>>} result payload.
     */
    async function request(path, init) {
      const options = {
        credentials: 'same-origin',
        ...init,
        headers: { accept: 'application/json', ...(init?.headers ?? {}) },
      }
      const response = await fetch(`${API}${path}`, options)
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error ?? `HTTP ${response.status}`)
      }
      return payload.result
    }

    /**
     * Format an ISO timestamp for display.
     * @param {unknown} value - timestamp.
     * @returns {string} local time or the original value.
     */
    function formatTime(value) {
      if (typeof value !== 'string' || value === '') return ''
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
    }

    /**
     * Localized source label.
     * @param {(key: string) => string} t - translator.
     * @param {unknown} source - stored source.
     * @returns {string} label.
     */
    function sourceText(t, source) {
      if (source === 'initial') return t('source.initial')
      if (source === 'manual') return t('source.manual')
      return t('source.none')
    }

    /**
     * Localized MCP status text.
     * @param {(key: string) => string} t - translator.
     * @param {Record<string, unknown> | undefined} status - manager status.
     * @returns {string} label.
     */
    function statusText(t, status) {
      const state = status?.state
      if (state === 'connected') return `${t('mcp.connected')} · ${t('mcp.tools')}: ${String(status.toolCount ?? 0)}`
      if (state === 'connecting') return t('mcp.connecting')
      if (state === 'reconnecting') {
        const attempt = status.attempt === undefined ? '' : ` (${String(status.attempt)}/${String(status.maxAttempts ?? '?')})`
        return `${t('mcp.reconnecting')}${attempt}`
      }
      if (state === 'failed') return `${t('mcp.failed')}: ${String(status.reason ?? '')}`
      if (state === 'waiting-credentials') return t('mcp.waiting')
      if (state === 'closed') return t('mcp.closed')
      if (state === 'disabled') return t('mcp.disabled')
      return t('mcp.connecting')
    }

    /**
     * CSS state class for one status.
     * @param {Record<string, unknown> | undefined} status - manager status.
     * @returns {string} class name.
     */
    function statusClass(status) {
      if (status?.state === 'connected') return 'dwm-ok'
      if (status?.state === 'failed') return 'dwm-bad'
      return 'dwm-warn'
    }

    /**
     * One label/value row.
     * @param {string} label - row label.
     * @param {object | string} value - rendered value.
     * @param {string} [key] - React key.
     * @returns {object} React node.
     */
    function row(label, value, key) {
      return h('div', { key: key ?? label, className: 'dwm-row' },
        h('span', { className: 'dwm-label' }, label),
        h('span', { className: 'dwm-value' }, value),
      )
    }

    /**
     * Settings page component.
     * @param {{ t: (key: string) => string, localeFace: { subscribe: Function, getSnapshot: Function }, api: { load: Function, refresh: Function } }} props
     *   injected locale translator and API client.
     * @returns {object} React node.
     */
    function WolframMcpSection(props) {
      const { t, localeFace, api } = props
      const [, setLocaleRevision] = React.useState(0)
      React.useEffect(
        () => localeFace.subscribe(() => setLocaleRevision((value) => value + 1)),
        [localeFace],
      )

      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let cancelled = false
        let inFlight = false
        const load = async () => {
          if (inFlight) return
          inFlight = true
          try {
            const next = await api.load()
            if (!cancelled) {
              setState(next)
              setError(null)
            }
          } catch (failure) {
            if (!cancelled) setError(String(failure?.message ?? failure))
          } finally {
            inFlight = false
            if (!cancelled) setLoading(false)
          }
        }
        void load()
        const timer = window.setInterval(load, 3000)
        return () => {
          cancelled = true
          window.clearInterval(timer)
        }
      }, [api])

      const refresh = React.useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const next = await api.refresh()
          setState(next)
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy(false)
        }
      }, [api])

      const running = busy || state?.refreshing === true
      const configText = state?.config ? JSON.stringify(state.config, null, 2) : ''
      const servers = Array.isArray(state?.mcpServers) ? state.mcpServers : []
      const skills = state?.skills ?? {}
      const installed = Array.isArray(skills.installed) ? skills.installed : []
      const skipped = Array.isArray(skills.skipped) ? skills.skipped : []
      const registrationErrors = Array.isArray(state?.registrationErrors) ? state.registrationErrors : []

      return h('section', { className: 'dwm-section' },
        h('header', { className: 'dwm-header' },
          h('h2', { className: 'dwm-title' }, t('title')),
          h('p', { className: 'dwm-desc' }, t('desc')),
        ),
        error !== null ? h('div', { className: 'dwm-alert' }, `${t('requestFailed')}: ${error}`) : null,
        state?.lastError ? h('div', { className: 'dwm-alert' }, `${t('lastError')}: ${state.lastError}`) : null,
        state && state.persisted === false
          ? h('div', { className: 'dwm-warnbox' }, `${t('persisted')}: ${t('persisted.no')} · ${String(state.statePath ?? '')}`)
          : null,
        loading && state === null ? h('p', { className: 'dwm-desc' }, t('loading')) : null,
        state !== null ? h('div', { className: 'dwm-card' },
          h('h3', { className: 'dwm-card-title' }, t('status.title')),
          h('div', { className: 'dwm-grid' },
            row(t('source'), sourceText(t, state.lastSource), 'source'),
            row(t('fetchedAt'), state.fetchedAt ? formatTime(state.fetchedAt) : t('never'), 'fetched'),
            row(t('attemptedAt'), state.lastAttemptAt ? formatTime(state.lastAttemptAt) : t('never'), 'attempted'),
            row(t('statePath'), h('code', { className: 'dwm-code' }, String(state.statePath ?? '')), 'state'),
            row(t('wolframscript'), h('code', { className: 'dwm-code' }, String(state.wolframscript ?? t('notFound'))), 'script'),
            row(t('wolframApp'), h('code', { className: 'dwm-code' }, String(state.wolframApp ?? t('notFound'))), 'app'),
            row(t('persisted'), state.persisted ? t('persisted.yes') : t('persisted.no'), 'persisted'),
          ),
        ) : null,
        state !== null ? h('div', { className: 'dwm-card' },
          h('div', { className: 'dwm-card-head' },
            h('h3', { className: 'dwm-card-title' }, t('config.title')),
            h('button', {
              type: 'button',
              className: 'dwm-button',
              disabled: running,
              onClick: refresh,
            }, running ? t('refreshing') : t('refresh')),
          ),
          h('p', { className: 'dwm-desc' }, t('config.hint')),
          h('textarea', {
            className: 'dwm-json',
            readOnly: true,
            spellCheck: false,
            wrap: 'off',
            'aria-label': t('config.title'),
            value: configText,
            placeholder: t('config.empty'),
          }),
          h('p', { className: 'dwm-footer' }, t('refreshHint')),
        ) : null,
        state !== null ? h('div', { className: 'dwm-card' },
          h('h3', { className: 'dwm-card-title' }, t('mcp.title')),
          servers.length === 0
            ? h('p', { className: 'dwm-desc' }, t('mcp.empty'))
            : h('div', { className: 'dwm-list' }, servers.map((server) => h('div', { key: server.name, className: 'dwm-list-row' },
              h('code', { className: 'dwm-code' }, server.name),
              h('span', { className: `dwm-state ${statusClass(server.status)}` }, statusText(t, server.status)),
            ))),
          state.lastRegisteredAt ? h('p', { className: 'dwm-footer' }, `${t('mcp.registeredAt')}: ${formatTime(state.lastRegisteredAt)}`) : null,
        ) : null,
        state !== null ? h('div', { className: 'dwm-card' },
          h('h3', { className: 'dwm-card-title' }, t('skills.title')),
          row(t('skills.root'), h('code', { className: 'dwm-code' }, String(skills.root ?? '')), 'skills-root'),
          installed.length > 0
            ? h('div', { className: 'dwm-chips' }, installed.map((name) => h('span', { key: name, className: 'dwm-chip' }, name)))
            : h('p', { className: 'dwm-desc' }, t('skills.none')),
          skipped.length > 0
            ? h('p', { className: 'dwm-footer' }, `${t('skills.skipped')}: ${skipped.map((item) => String(item.name ?? '')).join(', ')}`)
            : null,
          skills.error ? h('div', { className: 'dwm-alert' }, `${t('skills.error')}: ${String(skills.error)}`) : null,
        ) : null,
        registrationErrors.length > 0
          ? h('div', { className: 'dwm-alert' }, `${t('registrationErrors')}: ${registrationErrors.join('; ')}`)
          : null,
      )
    }

    /**
     * Monochrome navigation icon for the settings section.
     * @param {{ size?: number, active?: boolean }} props - owner props.
     * @returns {object} React node.
     */
    function WolframMcpIcon({ size = 16, active = false }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block', opacity: active ? 1 : 0.72 },
      },
        h('path', {
          d: 'M2.4 4.1 L5.3 12 L8 6.9 L10.7 12 L13.6 4.1',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: 2.4, cy: 4.1, r: 1.1, fill: 'currentColor' }),
        h('circle', { cx: 13.6, cy: 4.1, r: 1.1, fill: 'currentColor' }),
      )
    }

    /**
     * Persistent initialization notice shown in the frame-wide overlay.
     *
     * The component owns no dismiss timer: it polls the owner API and returns
     * null only when the Host phase leaves `fetching` / `mcp-starting`.
     *
     * @param {{ t: (key: string) => string, api: { load: Function } }} props
     *   injected locale translator and status client.
     * @returns {object | null} React node.
     */
    function WolframMcpStatusToast(props) {
      const { t, api } = props
      const [state, setState] = React.useState(null)

      React.useEffect(() => {
        let cancelled = false
        let inFlight = false
        const load = async () => {
          if (inFlight) return
          inFlight = true
          try {
            const next = await api.load()
            if (!cancelled) setState(next)
          } catch {
            // Keep the last known phase while the Host API is temporarily unavailable.
          } finally {
            inFlight = false
          }
        }
        void load()
        const timer = window.setInterval(load, 2000)
        return () => {
          cancelled = true
          window.clearInterval(timer)
        }
      }, [api])

      const phase = state?.phase
      const text = phase === 'fetching'
        ? t('toast.scanning')
        : phase === 'mcp-starting'
          ? t('toast.mcpStarting')
          : null
      if (text === null) return null
      return h('div', { className: 'dwm-toast-layer' },
        h('div', { className: 'dwm-toast', role: 'status', 'aria-live': 'polite' },
          h('span', { className: 'dwm-spinner', 'aria-hidden': true }),
          h('span', { className: 'dwm-toast-text' }, text),
        ),
      )
    }

    const STYLE = `
      .dwm-section{display:flex;flex-direction:column;gap:16px;max-width:840px;padding:4px 0 28px;color:var(--dsw-alias-label-primary)}
      .dwm-header{display:flex;flex-direction:column;gap:6px}
      .dwm-title{font-size:16px;font-weight:600;line-height:24px;margin:0;color:var(--dsw-alias-label-primary)}
      .dwm-desc{font-size:12px;line-height:18px;margin:0;color:var(--dsw-alias-label-tertiary)}
      .dwm-card{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0}
      .dwm-card-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .dwm-card-title{font-size:13px;font-weight:500;line-height:20px;margin:0;color:var(--dsw-alias-label-primary);flex:1 1 auto;min-width:0}
      .dwm-grid{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 16px;font-size:12px;line-height:18px}
      .dwm-row{display:contents}
      .dwm-label{color:var(--dsw-alias-label-tertiary);white-space:nowrap}
      .dwm-value{color:var(--dsw-alias-label-secondary);min-width:0;overflow-wrap:anywhere}
      .dwm-code{font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);word-break:break-all}
      .dwm-json{box-sizing:border-box;width:100%;min-height:240px;max-height:440px;resize:vertical;padding:10px 12px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;white-space:pre;overflow:auto;outline:none}
      .dwm-json:focus{border-color:var(--dsw-alias-brand-primary)}
      .dwm-button{height:30px;padding:0 12px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
      .dwm-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
      .dwm-button:disabled{opacity:.6;cursor:default}
      .dwm-alert{border:.5px solid var(--dsw-alias-state-error-primary);border-radius:var(--dsw-radius-sm);padding:8px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}
      .dwm-warnbox{border:.5px solid var(--dsw-alias-state-warn-primary);border-radius:var(--dsw-radius-sm);padding:8px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}
      .dwm-list{display:flex;flex-direction:column;gap:6px}
      .dwm-list-row{display:flex;align-items:center;gap:12px;justify-content:space-between;border-bottom:.5px solid var(--dsw-alias-border-l1);padding-bottom:6px;min-width:0}
      .dwm-list-row:last-child{border-bottom:none;padding-bottom:0}
      .dwm-state{font-size:12px;line-height:18px;text-align:right}
      .dwm-ok{color:var(--dsw-alias-state-success-primary)}
      .dwm-bad{color:var(--dsw-alias-state-error-primary)}
      .dwm-warn{color:var(--dsw-alias-state-warn-primary)}
      .dwm-muted{color:var(--dsw-alias-label-tertiary)}
      .dwm-chips{display:flex;flex-wrap:wrap;gap:6px}
      .dwm-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code);font-size:12px}
      .dwm-footer{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:0}
      .dwm-toast-layer{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:80;display:flex;flex-direction:column;align-items:center;gap:8px;max-width:calc(100vw - 32px);pointer-events:none}
      .dwm-toast{display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100vw - 32px));padding:10px 14px;border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-toast-bg,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;box-shadow:0 8px 24px rgba(0,0,0,.18)}
      .dwm-spinner{width:14px;height:14px;flex:none;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:dwm-spin .9s linear infinite}
      @keyframes dwm-spin{to{transform:rotate(360deg)}}
      .dwm-toast-text{min-width:0;overflow-wrap:anywhere}
    `

    /**
     * Mount the settings section and its navigation icon.
     * @param {object} ctx - Client plugin context.
     * @returns {void}
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'wolfram-mcp: locale')
      ctx.effect(() => {
        if (typeof document === 'undefined' || document.head === undefined) return undefined
        const tag = document.createElement('style')
        tag.dataset.plugin = '@local/dsh-wolfram-mcp'
        tag.textContent = STYLE
        document.head.appendChild(tag)
        return () => {
          tag.remove()
        }
      }, 'wolfram-mcp: section styles')

      const api = {
        load: () => request('/state'),
        refresh: () => request('/refresh', { method: 'POST' }),
      }
      const localeFace = {
        subscribe: (listener) => ctx.locale.subscribe(listener),
        getSnapshot: () => ctx.locale.getSnapshot(),
      }

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: SECTION_ID,
        order: SECTION_ORDER,
        label: () => t('section.label'),
        locale: NS,
        inject: () => ({ t, localeFace, api }),
      }, WolframMcpSection))

      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: SECTION_ID,
      }, WolframMcpIcon))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'wolfram-mcp.status-toast',
        order: 100,
        locale: NS,
        inject: () => ({ t, api }),
      }, WolframMcpStatusToast))
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
