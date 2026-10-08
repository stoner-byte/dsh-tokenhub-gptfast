# Design

## Context

动机见 proposal.md;行为契约见 `specs/tokenhub-fast-tier/spec.md`。

塑造方案的事实(均已实测或读源码确认):

- TokenHub 从**请求体**读 `service_tier`,不接受 header、没有 provider option、没有逐模型默认参数、没有别名约定。
- pi-ai 路由配置只有 `apiKeyEnv`、`api`、`baseURL`、`models`、`compat`、`transport`、`retryPolicy` 等键,**没有往请求体加字段的口子**。
- `llm` service 只暴露 `registerAdapter`(需自实现整个 Responses 协议),没有"注册一条带 baseURL 的路由"。
- 配置补丁只能整块替换 `config`(DSH 原文:`config is replaced wholesale, not deep-merged`),因此插件无法替使用者改路由配置。
- 当前 TokenHub 源码将 Responses 的 `service_tier` 定义为字符串,没有三个值的枚举限制;Codex 适配器把 `fast` 转为 `priority`。2026-10-08 线上直连的 `default`、`fast`、`priority` 都返回 200;无效值 `invalid-tier-probe` 返回上游 400。该轮流式完成事件与非流式响应回显 `default`,但不能推广为所有请求恒定如此,也不能仅凭测速确认实际服务档位。
- 档位只对 TokenHub 转 Codex 上游的 GPT 模型有效;Kimi 系列走别的上游。
- 变更开始时仓库只有 `handoff.md` 与 `openspec/`;参考实现曾跑通后被删除(handoff §6),本 change 按讨论结论重建并扩展。
- OpenAI Codex 官方规定:支持模型的 Fast 模式消耗订阅内含额度为普通档 2.5 倍,购买 credits / Enterprise 按量付费为 2 倍。这是上游 Codex 规则,不是 TokenHub 对使用者的收费结论;当前 TokenHub 的收费与本次请求的实际扣减尚未核实。API 定价另行计算。

## Goals / Non-Goals

**Goals:**

- 在本机、零协议实现的前提下给请求体补一个字段。
- 快速档可随时开关、白名单可改,且都在 DSH 设置界面里完成。
- 关闭或不符合条件时,请求字节级不变,行为可预期。
- 代理与 DSH 同生命周期,不产生需要手工清理的残留(进程或端口)。

**Non-Goals:**

- 不改 TokenHub、不改 DSH 源码。
- 不新增 LLM 路由条目。
- 不自实现 LLM 协议适配器。
- 不自动改写使用者的路由配置。
- 不自动选择空闲端口。
- 不发布到 npm(v1 用本地路径安装)。
- 不支持非 GPT 模型,不启用 `gpt-6-astra`(ultrafast 档,未实测)。

## Decisions

### D1:进程内回环 HTTP 代理

用 `node:http` 在 DSH 宿主进程内起一个回环服务,pi-ai 路由的 `baseURL` 指向它,只对命中请求补字段。

**为什么不是别的:**

| 方案 | 工作量 | 否决原因 |
|---|---|---|
| 注册专属 LLM 适配器 | 数百行 | 要自实现 SSE、工具调用、reasoning、usage、重试,重复官方实现 |
| 插件只做设置页 + 外部代理进程 | 最小 | 要跑第二个进程,与 DSH 生命周期解耦,安装体验更差 |
| 只改配置 | 0 | 上游读 body、pi-ai 无透传口,已逐条确认无插槽 |

回环代理是唯一"零协议实现"的形态:对外仍是同一次请求,多一跳本机 socket。参考实现实测 60.4 tok/s。

### D2:复用现有路由,不新增条目

`tokenhub` 路由的 `baseURL` 改为代理地址;模型选择器保持现状。

代价是代理成为这条路由的单点。换取的是:菜单不重复、插件不需要复制使用者的模型清单(补丁无法深合并,复制必然与其配置漂移)。使用者已明确要求不新增路由条目。

**备选(否决)**:bundle 自带一条新的 pi-ai 路由行。隔离性更好,但模型选择器里会多出一份同样的模型清单,且清单随使用者配置变更而漂移。

### D3:开关放在插件自己的 Config schema 里,界面由插件页的 row-config slot 渲染

插件导出 schemastery 的 `Config`(`enabled`、`models`),两项都标 `.volatile()`,再补一个浏览器半边(`lib/client.js`)注册 `plugins.row.config`(key = `dsh-tokenhub-fast#tokenhub-fast-proxy`)。DSH 插件页于是给这一行一个「配置」入口,并把 Host 持有的表单(`form.state` / `form.mutate(ops, revision)`)交给我们的 cell;开关与白名单的写入经 `settings` 服务落到该插件在 profile 补丁里的那一行。

**为什么必须 volatile(实测根因):** `dsh-settings` 的 `volatileForm()` 只投影带 `meta.volatile` 的字段;没有它,该条目连 settings 命名空间都不会出现,`form` 就是 `undefined`(第一版探针就是这样失败的)。另外 volatile 写入由 Loader 的 `_commitVolatile` **原地提交进运行时 accessor**,不重挂插件 —— 所以读取必须走 `field.get()`,而且不能在 `apply` 里缓存值。官方 `agent-loop` 的 `maxParallelToolCalls` 同款用法。

**为什么不是别的:** 手改 YAML 需要使用者碰配置文件;env 变量需要重启且 GUI 启动方式下不好设;插件页的 bundle/row 自绘页面(不经 Host 表单)要自己接 Remote 命名空间,工作量更大。

`@deepseek-ai/schemastery` 已在 profile 的 `node_modules` 中,声明依赖即可,无需新增安装。浏览器半边只用 `require('react')`(浏览器模块表的基线模块),不 import 任何 Harness 客户端包。

`@deepseek-ai/schemastery` 已在 profile 的 `node_modules` 中,声明依赖即可,无需新增安装。

### D4:端口固定 8788

pi-ai 的 `baseURL` 是静态配置,而补丁只能整块替换 `config`,插件又无法在运行时注册一条带 baseURL 的路由。所以端口必须写死,并接受"占用即失效"。

**被否决的替代:** 自动选空闲端口。它要求插件自己拥有那条路由,即 D1 里被否决的适配器方案。

端口只在两处被引用:插件常量与 README。bundle 里不带 `baseURL`,所以不存在"改一处、另一处失效"的补丁文件。挂载时日志回显期望的 `baseURL`(含端口),使用者可直接对照自己的路由配置。

### D5:关闭 = 纯透传,而非切回直连

`enabled: false` 时插件仍在链路上,但一个字段都不改。"完全直连"需要插件用 `configEditor` 去改使用者的路由配置,属于 D6 排除的范围。

纯透传的失效面更小:即使开关状态判断出错,请求内容也不变。

### D6:插件不写别人的配置

不实现"插件自动把使用者路由的 `baseURL` 指向代理"。`configEditor.edit()` 可以做到,但那是插件替使用者写盘,出问题时最难排查。v1 由使用者在设置界面改一次。

### D7:注入判据用白名单,不用黑名单

只有显式列在 `models` 里的模型才注入。上游对未知值返回 400,而 Kimi 系列走别的上游,黑名单式"除了 Kimi 都注入"会随新模型出现而失控。

### D8:安全边界

- 只监听 `127.0.0.1`。
- 只转发到固定上游主机;拒绝路径不以 `/v1/` 开头的请求(参考实现是任意路径全通,等于给本机进程开了一条通往该主机的任意路径通道)。
- 上游主机默认固定为 `token.yoso-ai.com`,只接受 `DSH_TOKENHUB_FAST_UPSTREAM` 一个环境变量覆盖(供测试指向本地 stub)。请求内容本身永远不能改变目标主机。
- 认证头只透传,不读取、不记录。
- 转发时固定 `accept-encoding: identity`,避免压缩与流式转发叠加出的复杂度。

### D9:生命周期与崩溃安全

用 `ctx.effect` **同步**注册监听,返回 `server.close()` 作为 disposer。异步注册会以 `cannot create effect on inactive context` 直接崩掉 DSH 启动。

`server.on('error')` 在 `listen` 之前挂,端口占用时只记警告。

代理与 DSH 同进程,因此 DSH 退出即释放端口,不存在孤儿进程;被 SIGKILL 也由 OS 回收。

## Risks / Trade-offs

- [代理是 tokenhub 全部 7 个模型的单点] → 端口占用只警告不崩溃;迁移方案给出"先改回 baseURL 再卸载"的回滚顺序。
- [设置界面里看不到任何可编辑项] → 字段必须标 `.volatile()`,并且要有一个浏览器半边;两者缺一,插件页就不出现「配置」入口(实测:只有宿主 schema 时,设置里只有只读清单)。
- [菜单里看不出快速档是否生效] → 挂载时输出一行日志说明开关状态与白名单,每次启动都回显。
- [上游 Codex Fast 消耗订阅额度 2.5 倍 / credits 2 倍] → README 引用官方文档并限定上游适用范围;TokenHub 对使用者收费与实际扣减未核实,不承诺相同倍数。
- [本轮显式请求 `fast` / `priority` 仍回显 `default`] → 列为已知验证限制。插件验收以请求体注入、开关透传和链路可用为准;吞吐对比仅是性能观测,不能证明实际服务档位,也不保证 1.5 倍。
- [白名单内的模型若不被上游接受会返回 400] → 验收阶段对每个默认模型各打一发,不通过的从默认白名单移除。
- [使用者改 `baseURL` 后卸载插件会留下死端口] → README 与回滚步骤都写明顺序。
- [开发期读 asar 内容会踩 `Not a directory` 或静默空结果] → 一律用 `ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' -e '<脚本>'`。
- [在 desktop profile 上直接实验] → 先在 scratch profile 验证组合与端口归属,通过后才动 desktop 的 `baseURL`。

## Migration Plan

安装与启用(先在 scratch,后 desktop):

1. 建 scratch profile 并安装本仓库作为 bundle: `dsh plugin --profile scratch1 add /Users/stoner/code/dsh-tokenhub-fast`。
2. 确认 `lsof -nP -iTCP:8788 -sTCP:LISTEN` 显示的进程属于 DSH。
3. 在 scratch 的 profile 补丁里把 `tokenhub` 路由的 `baseURL` 指向 `http://127.0.0.1:8788/v1`(scratch 可丢弃)。
4. 验证请求字段注入、关闭态透传和链路可用;吞吐对比只记录性能观察,不据此确认实际服务档位。
5. 通过后,在 desktop 的**设置界面 → 模型** 里把 `baseURL` 改成同一地址;插件开关在 **插件 → dsh-tokenhub-fast → 配置**(设置里的「内置插件」只是只读清单)。
6. 删除 scratch profile。

回滚:

1. 先在设置界面把 `baseURL` 改回 `https://token.yoso-ai.com/v1`(立即恢复直连,插件留着也只是纯透传)。
2. 再卸载插件;`plugin remove` 会清掉 bundle 与其补丁行,端口随之释放。
3. 只回滚开关(不碰 `baseURL`)时,把 `enabled` 设为 `false` 即可,行为等价直连(除多一跳本机 socket)。

## Open Questions

- GUI 与注入行为已验证。2026-10-08 线上请求 `fast` / `priority` 最终仍回显 `default`:尚未取得同一次请求转换前的原始上游响应或实际额度扣减,不能确认上游实际服务档位。使用者明确接受暂不继续追查,将其作为 v1 已知限制,不阻塞行为验收。
- TokenHub 向使用者收取的费用与本次测试实际额度扣减未核实。Codex 官方倍数只描述上游账户规则,不代替 TokenHub 定价。
- 封版不包含主规格同步或归档动作;待使用者另行授权。

## Resolved during implementation

- 开关的界面落点(原定"DSH 设置界面自动投影 Config"):**宿主 schema 不会自动生成表单**。设置里的「内置插件」只是只读清单;插件自己的配置只在**插件页**渲染,且需要包自带浏览器半边。实测确认三者缺一不可:`.volatile()` 标记、`dsh.client` + `lib/client.js`、`plugins.row.config` 注册。
- 开关的生效方式:作为 volatile 字段,写入由 Loader 原地提交进运行时 accessor,**不重挂插件**,所以 8788 不会因切换而断开;代理改为每次请求读 `field.get()`,而不是在 `apply` 里缓存(`test/proxy.test.js` 的 "follows a live volatile config without a remount" 守着这条)。
- 默认白名单(原定 `gpt-6-sol`、`gpt-6-luna`、`gpt-6.1-sol`):历史请求均返回 200,但 `gpt-6-luna` 在该轮未观察到收益 —— 经代理 78.4 tok/s、直连 79.6 tok/s(各 4 次)。不能由此断言模型已达速度上限或 TokenHub 必然按 2.5 倍收费。默认白名单改为 `gpt-6-sol`、`gpt-6.1-sol`,`gpt-6-luna` 可手动加入,规格与代码默认值一致。
- 2026-10-08 新一轮测速:直接请求线上 TokenHub,同模型 `gpt-6.1-sol`、同提示、同 Codex 账号和路由,只切换 `default` / `fast`,两组各 4 次并交替顺序。扣除 reasoning 后,正文输出速率中位数为 32.2 / 45.1 tok/s,比值 1.40;配对比值范围 1.24–1.48、中位数 1.35。八次最终响应都是 `default`。这是性能观测,不证明实际上游档位,不保证稳定 1.5 倍或整段回答时间缩短相同比例。
