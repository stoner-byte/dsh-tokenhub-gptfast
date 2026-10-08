# Proposal

## Why

DSH 当前的 TokenHub 路由没有配置请求体的 `service_tier`。本 change 为指定模型请求快速档;TokenHub 的 Codex 适配器把 `fast` 映射为 `priority`。2026-10-08 同模型、同提示、同账号和路由的对照测试中,普通档与快速档各 4 次,输出速率中位数为 32.2 / 45.1 tok/s,约 1.40 倍;各轮配对比值中位数为 1.35 倍。原先的 39 / 55-62 tok/s 和 1.5 倍是估数,不作为验收承诺。测试的最终响应仍回显 `default`,实际服务档位尚未确认。

TokenHub 只从**请求体**读 `service_tier`:没有 header 开关,provider 的 `Options` 里没有档位项,没有逐模型默认参数,没有 `-fast` 别名。DSH 侧同样没有插槽:pi-ai 路由配置里没有"往 body 加字段"的口子,插件唯一的报文入口 `ctx.llm.registerAdapter` 要求自己实现整套 Responses 协议。

因此采用出站代理补充请求字段,以请求快速档;实际上游选档由上游决定。

## What Changes

- 新增一个 DSH 插件包 `dsh-tokenhub-fast`,作为 bundle 安装(先本地路径)。它在 **DSH 宿主进程内**起一个回环 HTTP 代理,监听 `127.0.0.1:8788`。
- 代理只对 `POST /v1/responses` 且 `body.model` 在配置白名单内的请求补 `service_tier: "fast"`;其余请求(非 JSON、其它路径、其它模型、已显式带档位的)一律字节透传。
- 复用现有 `tokenhub` pi-ai 路由,把它的 `baseURL` 指向代理。**不新增路由**,模型选择器保持现状。
- **BREAKING**:该路由的 `baseURL` 必须改成 `http://127.0.0.1:8788/v1`,代理随后成为这条路由的单点。若卸载插件而不同时改回 `baseURL`,tokenhub 下全部 7 个模型不可用。
- 插件声明 volatile Config:`enabled`(总开关)与 `models`(注入白名单),浏览器半边在插件页的 `plugins.row.config` 渲染表单。改动经 Host 表单写回 profile 补丁并原地更新运行时 accessor,无需重挂插件或手工编辑配置文件。
- 端口固定 `8788`。端口被占用时挂 `error` 监听、记警告日志、让快速档失效,不抛未捕获异常、不阻断 DSH 启动。

## Capabilities

### New Capabilities

- `tokenhub-fast-tier`: 按模型向 TokenHub 请求体注入上游服务档位(`service_tier`),并提供总开关与模型白名单;非目标请求保持字节级透传。

### Modified Capabilities

无。本仓库当前没有任何 spec。

## Impact

- 新增代码:本仓库新增插件包(`package.json`、`cordis.patch.yml`、`lib/index.js`、`test/inject.test.js`、`README.md`)。仓库当前只有 `handoff.md` 与 `openspec/`。
- 依赖:新增声明 `@deepseek-ai/schemastery`(该包已在 profile 的 `node_modules` 中,无需额外安装)。
- 不改 DSH 源码,不用非公开接口;不改 TokenHub 源码。
- 运维影响:
  - 使用者需把 `tokenhub` 路由的 `baseURL` 指向代理(设置页即可,一次性)。
  - 代理与 DSH 同进程,同生共死;代理失效时整条 tokenhub 路由失效。
  - OpenAI Codex 官方 Fast 规则为上游订阅内含额度 2.5 倍、购买 credits / Enterprise 按量付费 2 倍;不据此断言 TokenHub 向使用者收取相同倍数。TokenHub 收费与本次实际扣减未核实,OpenAI API 定价另算。
  - 适用范围仅限 TokenHub 转 Codex 上游的 GPT 模型;Kimi 系列不适用,不得加入白名单。
