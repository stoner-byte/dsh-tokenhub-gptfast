# tokenhub-fast-tier Specification

## Purpose

让 DSH 发往 TokenHub 的模型请求可以按模型带上上游的 `fast`(priority)服务档位,并让使用者能随时开关这一行为,同时在关闭或不符合条件时保持请求字节不变。

## Requirements

### Requirement: 按模型注入服务档位

插件 SHALL 对命中条件的模型请求在请求体中注入 `service_tier` 字段,值为 `"fast"`。命中条件为:方法是 `POST`、路径以 `/v1/responses` 开头、请求体是 JSON 对象、`model` 字段在白名单内、且请求体尚未包含 `service_tier`。

#### Scenario: 白名单内模型的请求被注入

- **WHEN** 客户端发送 `POST /v1/responses`,请求体为 JSON 对象且 `model` 在白名单内,且没有 `service_tier` 字段
- **THEN** 转发到上游的请求体包含 `service_tier: "fast"`,其余字段与客户端发送的完全一致

#### Scenario: 注入只发生一次

- **WHEN** 同一个请求被代理处理一次
- **THEN** 上游只收到一个 `service_tier` 字段,且值为 `"fast"`

### Requirement: 显式档位优先

请求体已包含 `service_tier` 时,插件 SHALL 保留调用方给出的值,SHALL NOT 覆盖它。

#### Scenario: 调用方指定 default

- **WHEN** 客户端发送的请求体已包含 `service_tier: "default"`,且模型在白名单内
- **THEN** 上游收到的 `service_tier` 仍是 `"default"`

#### Scenario: 调用方指定非法值

- **WHEN** 客户端发送的请求体包含 `service_tier: "bogus"`,且模型在白名单内
- **THEN** 插件不改动该字段,上游自行返回其错误响应

### Requirement: 非目标请求字节级透传

不满足注入条件的请求,插件 SHALL 原样转发,SHALL NOT 改动请求体、方法或路径。

#### Scenario: 白名单外模型

- **WHEN** 请求体里的 `model` 不在白名单内(例如 `kimi-k2.7-code`)
- **THEN** 转发到上游的请求体与客户端发送的字节完全相同,不新增任何字段

#### Scenario: 非 JSON 请求体

- **WHEN** 请求体不是合法 JSON(或不是 JSON 对象)
- **THEN** 插件原样转发该字节序列

#### Scenario: 其它路径

- **WHEN** 请求路径不是 `/v1/responses` 开头(例如 `GET /v1/models`)
- **THEN** 插件原样转发,不改动请求体

### Requirement: 总开关

插件 SHALL 提供布尔配置 `enabled`。该值为假时,插件 SHALL NOT 注入任何字段,全部请求按透传处理。

#### Scenario: 关闭开关后不再注入

- **WHEN** `enabled` 为 `false`,且客户端发送白名单内模型的 `POST /v1/responses`
- **THEN** 上游收到的请求体与客户端发送的完全相同,不含插件注入的 `service_tier`

#### Scenario: 关闭开关不影响转发

- **WHEN** `enabled` 为 `false`
- **THEN** 请求仍被正常转发到上游并返回响应,状态码与响应体不变

### Requirement: 可配置的模型白名单

插件 SHALL 接受字符串数组配置 `models` 作为注入白名单。未配置时 SHALL 默认使用 `gpt-6-sol`、`gpt-6.1-sol`。

#### Scenario: 默认白名单

- **WHEN** 配置未提供 `models`
- **THEN** 上述两个模型被注入,其它模型透传

#### Scenario: 自定义白名单

- **WHEN** 配置把 `models` 设为只含 `gpt-6.1-sol`
- **THEN** 只有 `gpt-6.1-sol` 被注入,`gpt-6-sol` 透传

### Requirement: 配置在插件页可改且无需重启

开关与白名单 SHALL 经 DSH Web 界面的插件页暴露为可编辑项,使用者 SHALL NOT 需要手工编辑配置文件。改动 SHALL 在不重启 DSH 的情况下生效。

这两项配置 SHALL 标记为 volatile,否则 DSH 的设置表单不会投影该条目,插件页也就不存在可编辑项。

#### Scenario: 插件页切换开关

- **WHEN** 使用者在插件页把开关从开改为关
- **THEN** 后续请求按关闭后的行为处理,无需重启 DSH

#### Scenario: 配置持久化

- **WHEN** 使用者在插件页修改开关或白名单
- **THEN** 该改动被写入 profile 补丁并在 DSH 重启后仍然生效

#### Scenario: 清除覆盖恢复默认

- **WHEN** 使用者点击「恢复默认」
- **THEN** profile 补丁中该插件的 `config` 覆盖被移除,开关与白名单回到 schema 默认值

### Requirement: 固定监听地址

插件 SHALL 监听 `127.0.0.1:8788`,SHALL NOT 监听其它地址或端口。该地址是使用者配置上游路由 `baseURL` 的唯一依据。

#### Scenario: 只在回环地址监听

- **WHEN** 插件已挂载
- **THEN** 该端口只在 `127.0.0.1` 上处于监听状态,不对外网卡开放

### Requirement: 监听失败不阻断 DSH 启动

端口不可用时,插件 SHALL 记录警告并让快速档失效,SHALL NOT 抛出未捕获异常、SHALL NOT 阻断 DSH 启动。

#### Scenario: 端口已被占用

- **WHEN** `127.0.0.1:8788` 已被其它进程占用
- **THEN** DSH 正常启动,日志出现一条警告,快速档不可用

### Requirement: 上游目标固定

插件 SHALL 只把请求转发到固定上游主机(默认为 `token.yoso-ai.com`),且 SHALL 拒绝转发路径不以 `/v1/` 开头的请求,SHALL NOT 依据请求内容改投其它主机。

#### Scenario: 路径白名单

- **WHEN** 收到路径为 `/admin` 的请求
- **THEN** 插件直接返回错误响应,不向上游发起请求

#### Scenario: 上游主机不可替换

- **WHEN** 请求头或请求体中出现任何指向其它主机的信息
- **THEN** 请求仍然只被转发到配置的上游主机

### Requirement: 认证信息只透传不落盘

插件 SHALL 把调用方的认证相关请求头原样转发给上游,SHALL NOT 读取、记录或持久化凭据内容。

#### Scenario: 认证头透传

- **WHEN** 客户端请求带有 `authorization` 头
- **THEN** 上游收到的 `authorization` 头与客户端发送的完全一致,插件不另行添加凭据

#### Scenario: 日志不含凭据

- **WHEN** 插件输出任何日志
- **THEN** 日志内容不包含认证头或 API key 的值

### Requirement: 流式响应边到边转发

上游返回流式响应时,插件 SHALL 按到达顺序立即转发数据块,SHALL NOT 等整个响应结束后再发送。

#### Scenario: SSE 首块及时到达

- **WHEN** 上游开始发送 SSE 事件
- **THEN** 客户端在插件收到这些事件后立即收到,不出现整体延迟到响应结束的情况
