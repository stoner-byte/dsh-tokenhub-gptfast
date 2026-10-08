# Proposal

## Why

现有插件把上游站点、请求档位和生成接口固定为 TokenHub、`fast` 和 Responses，无法直接给使用其它中转站的 DSH 用户复用。新版面向通过中转站接入 GPT 的用户：允许配置 API baseURL，兼容 Responses 与 Chat Completions；第一批用户是使用相同中转站和模型 ID 的同事。

## What Changes

- **BREAKING**：包名、宿主插件名、实例 ID 和浏览器模块 ID 统一为 `dsh-tokenhub-gptfast`，同步修改配置页绑定和安装说明。旧版未正式发布，直接重新安装，不迁移旧配置，不提供旧名称或旧 ID 的兼容层。
- 每个 profile 只配置一个上游，新增 GUI 字段 `upstreamBaseURL`，默认留空。用户填写 API baseURL，而不是完整生成接口 URL；保留上游路径前缀，兼容末尾斜杠，不重复拼接 `/v1`。
- 新增 GUI 字段 `tier`，仅提供 `fast` / `priority`，默认 `fast`；一个上游统一使用所选档位。
- 生成接口扩展为 `POST /v1/responses` 与 `POST /v1/chat/completions`，按接口路径精确判断，不向子接口误注入，不转换协议。
- 白名单继续由用户配置，默认 `['gpt-6-sol', 'gpt-6.1-sol']`。只按请求中的模型 ID 精确匹配，不检查 `gpt` 前缀，也不识别实际模型类型；中转站别名命中即注入。
- **BREAKING**：`enabled` 默认由开启改为关闭。上游未配置时，即使开关关闭也明确返回配置错误，不回退到旧 TokenHub 地址或任何默认站点。
- API 地址、白名单和档位编辑后统一点击“保存”；开关即时提交。配置持久化且无需重启；请求开始时读取配置快照，在途请求不受后续修改影响。
- **BREAKING**：“恢复默认”只重置开关、白名单和档位，保留已保存的 API 地址，不再删除整块配置。
- 保留已显式提供的 `service_tier`。关闭或不命中时不改请求体；允许的其它 API 请求继续转发。
- 校验目标 URL：远程使用 HTTPS，HTTP 只允许本机测试；拒绝内嵌账号密码和代理自身。界面提示认证头会发送给所填目标，凭据仍由 DSH 管理，插件不另存、不记录。
- 保留 `127.0.0.1:8788`、同步生命周期与端口冲突警告。用户手动修改原提供商地址，不新增路由、不自动修改提供商配置。
- 保留普通 HTTP 和 SSE 流式透传；不增加 WebSocket、测速、额度查询、自动降档或额外重试。不保证上游选档、速度倍数或收费规则。

## Capabilities

### New Capabilities

无。复用既有能力，不因插件改名创建重复的规格目录。

### Modified Capabilities

- `tokenhub-fast-tier`：将既有档位注入能力通用化，修改接口判定、档位选择、开关默认、配置保存与重置、上游选择和路径映射；增加统一命名、URL 安全与失败处理要求。保留固定端口、认证透传和流式响应契约。

## Impact

- 宿主：[代理实现](<lib/index.js>)，扩展 Config、请求级快照、注入判据、URL 校验和转发路径构造。
- 客户端：[配置页](<lib/client.js>)，增加 API 地址输入和档位选择，统一保存与局部重置，更新模块 ID、绑定键、文案与可访问标签。
- 包装：[包清单](<package.json>)、[锁文件](<package-lock.json>)、[bundle 补丁](<cordis.patch.yml>)，同步包与实例命名。工作区目录无需改名。
- 验证：扩展 [注入测试](<test/inject.test.js>) 和 [代理测试](<test/proxy.test.js>)，继续使用 `node:test` 与本地 stub，不引入测试框架或真实额度依赖。
- 文档：[README](<README.md>) 改为通用中转站的安装、配置、安全提示与回滚说明；旧归档作为历史记录保留，不改写。
- 不新增依赖，不改 DSH 或中转站源码。当前规划不安装、卸载插件，不修改 desktop profile、凭据或主规格；正式实现和安装验证分别按授权进行。
