# Spec Delta

## MODIFIED Requirements

### Requirement: 按模型注入服务档位

插件 SHALL 在启用且上游配置有效时，对生成接口请求按白名单注入 `service_tier`。命中条件为：方法为 `POST`，路径恰为 `/v1/responses` 或 `/v1/chat/completions`，请求体为 JSON 对象，`model` 精确命中白名单，且对象尚未包含 `service_tier`。注入值 SHALL 使用配置 `tier`；该配置 SHALL 只接受 `fast` 或 `priority`，默认 `fast`，对两个接口和全部白名单模型统一生效。判定接口路径 SHALL 忽略请求的查询参数。

#### Scenario: 白名单内模型的请求被注入

- **WHEN** 插件开启且上游已配置，客户端发送 `POST /v1/responses`，JSON 对象中的 `model` 命中白名单且没有 `service_tier`，`tier` 未覆盖
- **THEN** 上游请求包含 `service_tier: "fast"`，其余字段与客户端发送的相同

#### Scenario: 注入只发生一次

- **WHEN** 满足注入条件的同一个请求被代理处理一次
- **THEN** 上游只收到一个 `service_tier` 字段，其值等于所选档位

#### Scenario: Chat Completions 使用同一注入规则

- **WHEN** 插件开启且上游已配置，客户端发送满足白名单和 JSON 条件的 `POST /v1/chat/completions`
- **THEN** 请求包含所选 `service_tier`，原有 messages、stream 和其它字段不变，不转换成 Responses 请求

#### Scenario: 配置 priority

- **WHEN** `tier` 为 `priority`，任一生成接口的请求满足注入条件
- **THEN** 上游收到 `service_tier: "priority"`，插件不将其转换为 `fast`

#### Scenario: 生成接口带查询参数

- **WHEN** 客户端发送 `POST /v1/responses?trace=1` 或 `POST /v1/chat/completions?trace=1`，其它注入条件满足
- **THEN** 请求仍命中对应生成接口，且查询参数保留

### Requirement: 非目标请求字节级透传

在上游已配置且路径允许转发时，不满足注入条件的请求 SHALL 保持请求体字节和方法不变；接口相对路径及查询参数 SHALL 按上游 baseURL 的映射规则保留。插件 SHALL NOT 对生成接口的子路径、其它接口或非 POST 请求注入字段。安全校验拒绝的路径与无效上游配置 SHALL 返回本地错误，SHALL NOT 被当作普通透传请求发送。

#### Scenario: 白名单外模型

- **WHEN** 插件开启，请求体里的 `model` 不在白名单内
- **THEN** 上游收到与客户端完全相同的请求体字节，不新增字段

#### Scenario: 非 JSON 请求体

- **WHEN** 上游配置有效且请求体不是合法 JSON，或不是 JSON 对象
- **THEN** 插件原样转发请求体字节

#### Scenario: 其它路径

- **WHEN** 上游配置有效，客户端发送 `GET /v1/models`
- **THEN** 插件按配置的上游 API 根路径转发 models 接口，不改方法、查询参数或请求体

#### Scenario: 生成接口子路径不被误注入

- **WHEN** 客户端发送 `POST /v1/responses/compact`、`POST /v1/responses-other` 或其它生成接口子路径
- **THEN** 允许的请求正常转发，但不被当作生成接口注入 `service_tier`

#### Scenario: 生成接口的非 POST 请求

- **WHEN** 客户端发送生成接口路径的非 POST 请求且上游配置有效
- **THEN** 方法和请求体保持不变，不注入档位

### Requirement: 总开关

插件 SHALL 提供布尔配置 `enabled`，默认 `false`。关闭时 SHALL NOT 注入任何字段；上游配置有效的允许请求 SHALL 继续转发，不切回直连、不删除调用方已有档位。关闭开关 SHALL NOT 绕过上游配置与安全校验。

#### Scenario: 关闭开关后不再注入

- **WHEN** `enabled` 为 `false`，上游已配置，客户端发送白名单内模型的生成请求
- **THEN** 上游收到的请求体字节与客户端完全相同，不含插件新增的字段

#### Scenario: 关闭开关不影响转发

- **WHEN** `enabled` 为 `false` 且上游配置有效
- **THEN** 允许的请求正常转发，上游状态码和响应体保留

#### Scenario: 新安装默认关闭

- **WHEN** 新安装没有提供 `enabled` 配置
- **THEN** 开关显示关闭，插件不默认请求快速档

### Requirement: 可配置的模型白名单

插件 SHALL 接受字符串数组 `models`，默认 `['gpt-6-sol', 'gpt-6.1-sol']`。模型是否命中 SHALL 只取决于请求 JSON 对象的 `model` 与列表项是否精确相等，SHALL NOT 要求名称包含 `gpt`，SHALL NOT 识别实际模型类型或自动扩展名单。空白名单 SHALL 表示不注入任何模型。

#### Scenario: 默认白名单

- **WHEN** 上游已配置且开关开启，配置未提供 `models`
- **THEN** 只有 `gpt-6-sol` 与 `gpt-6.1-sol` 通过模型白名单判断，其它模型不通过

#### Scenario: 自定义白名单

- **WHEN** 上游已配置且开关开启，`models` 只含 `gpt-6.1-sol`
- **THEN** 该模型的符合条件请求被注入，`gpt-6-sol` 请求体不变

#### Scenario: 不含 gpt 的中转站别名

- **WHEN** 上游已配置且开关开启，`models` 含 `team-coder`，请求的 `model` 恰为 `team-coder`
- **THEN** 该请求通过白名单判断，不因为名字缺少 `gpt` 而被排除

#### Scenario: 空白名单

- **WHEN** `models` 为空数组
- **THEN** 两个生成接口的请求均不因模型命中而注入档位

### Requirement: 配置在插件页可改且无需重启

插件页 SHALL 提供开关、API baseURL、白名单与档位编辑。开关 SHALL 即时提交；地址、白名单、档位 SHALL 通过保存动作一并提交，未保存草稿 SHALL NOT 影响请求。配置 SHALL 持久化且无需重启。每个请求 SHALL 使用开始接收时的配置快照，后续修改 SHALL NOT 改变在途请求。恢复默认 SHALL 仅重置开关、白名单和档位，保留已保存的 API 地址。可编辑控件 SHALL 有可访问名称和明确的错误反馈。

#### Scenario: 插件页切换开关

- **WHEN** 使用者切换开关且提交成功
- **THEN** 后续请求使用新开关值，无需保存其它草稿或重启代理

#### Scenario: 配置持久化

- **WHEN** 使用者提交开关，或保存地址、白名单和档位
- **THEN** 已提交的值写入当前 profile 的该插件配置，DSH 重启后仍生效

#### Scenario: 清除覆盖恢复默认

- **WHEN** 使用者已有 API 地址，随后点击恢复默认
- **THEN** 开关恢复关闭，白名单恢复两个默认模型，档位恢复 `fast`，已保存的 API 地址保持不变

#### Scenario: 编辑草稿不影响当前请求

- **WHEN** 使用者编辑地址、白名单或档位但尚未保存
- **THEN** 当前及后续请求继续使用已保存配置，界面不将草稿显示成已提交成功

#### Scenario: 保存后在途请求保持原目标

- **WHEN** 请求已经开始接收或响应仍在流式转发，使用者保存新地址或其它配置
- **THEN** 该请求使用开始时的快照完成；保存完成后开始的新请求使用新配置，监听端口不重挂

#### Scenario: 保存或重置失败

- **WHEN** 配置校验失败或提交被拒绝
- **THEN** 界面显示错误，不报告成功，不部分应用该次地址、白名单和档位保存，不使已保存地址因重置失败而丢失

#### Scenario: 配置控件有明确标签

- **WHEN** 使用者通过键盘或辅助技术操作配置页
- **THEN** 开关、地址输入、白名单输入、档位选择和操作按钮均具有对应的可访问名称

### Requirement: 上游目标固定

插件 SHALL 提供单一 `upstreamBaseURL` 配置，默认空字符串；每个请求 SHALL 只向快照中的合法目标发送。插件 SHALL 拒绝非 `/v1/` 范围的请求，并把该本机 API 前缀后的接口相对路径映射到配置的 API 根路径，保留查询参数。插件 SHALL NOT 根据请求头、请求体或请求行改选主机，SHALL NOT 自动补充上游 `/v1`，SHALL NOT 丢弃配置的路径前缀。未配置或配置无效时 SHALL 返回明确的本地配置错误，不向任何上游发送请求或凭据，不使用旧站点或环境变量兜底。

#### Scenario: 路径白名单

- **WHEN** 收到路径为 `/admin` 或绝对 URL 请求行的请求
- **THEN** 插件直接返回错误，不向上游发起请求

#### Scenario: 上游主机不可替换

- **WHEN** 请求头或请求体出现其它主机信息，或请求行使用协议相对地址
- **THEN** 请求内容不能选择另一主机；不合法请求行被拒绝，合法请求只使用配置目标

#### Scenario: 保留自定义 API 路径前缀

- **WHEN** API 地址为 `https://relay.example/gateway/openai/v1`，收到 `/v1/responses?trace=1`
- **THEN** 目标为 `https://relay.example/gateway/openai/v1/responses?trace=1`

#### Scenario: 兼容末尾斜杠

- **WHEN** API 地址分别为 `https://relay.example/v1` 和 `https://relay.example/v1/`，收到同一 `/v1/chat/completions` 请求
- **THEN** 两者目标均为 `https://relay.example/v1/chat/completions`，不重复 `/v1` 或路径分隔符

#### Scenario: API 根路径不包含 v1

- **WHEN** 用户填写 `https://relay.example/openai`，收到 `/v1/models`
- **THEN** 目标为 `https://relay.example/openai/models`，插件不猜测版本或自动补 `/v1`

#### Scenario: 路径穿越不能绕过 API 根路径

- **WHEN** 请求的路径经过规范化将离开允许的本机 API 路径或配置的上游路径前缀
- **THEN** 插件拒绝请求，不向 API 根路径以外的位置发送认证头

#### Scenario: 上游未配置

- **WHEN** API 地址留空，无论开关开启或关闭，收到允许范围的请求
- **THEN** 插件返回明确配置错误，不回退到 TokenHub 或其它默认地址，不发送认证头

#### Scenario: 已存上游配置不合法

- **WHEN** 运行配置中的 API 地址不满足目标 URL 安全要求
- **THEN** 代理返回配置错误，不发起网络请求，DSH 不因未捕获异常而崩溃

## ADDED Requirements

### Requirement: 插件标识统一且不迁移旧配置

新版本的包名、宿主插件名、实例 ID 与浏览器模块 ID SHALL 为 `dsh-tokenhub-gptfast`，配置页 SHALL 绑定该实例。新安装 SHALL 使用新版本默认配置，SHALL NOT 导入旧 ID 配置、提供旧名称别名或自动修改原提供商配置。

#### Scenario: 新名称打开配置页

- **WHEN** 新版 bundle 安装并挂载
- **THEN** 实例 ID 与插件包名相同，插件页能打开该实例的配置，不因旧绑定键而缺失表单

#### Scenario: 旧配置不被迁移

- **WHEN** 用户重新安装新版且此前存在旧名称或旧 ID 的配置
- **THEN** 新版不读取或复制该配置；用户自行填写新地址，默认开关关闭、模型为默认两个 ID、档位为 `fast`

### Requirement: 目标 URL 安全与认证提示

插件 SHALL 验证 API baseURL 为合法绝对 HTTP(S) URL。远程地址 SHALL 使用 HTTPS；HTTP SHALL 仅允许本机回环测试目标。地址 SHALL NOT 包含用户名、密码、查询串或片段，SHALL NOT 指向本机代理自身，SHALL NOT 填写完整生成接口 URL。界面 SHALL 在地址配置处明确提示请求的认证头会发送给所填目标，SHALL NOT 为配置目标新增 API Key 存储。

#### Scenario: 非法目标保存被拒绝

- **WHEN** 使用者填写不合法 URL、非 HTTP(S) 协议、内嵌账号密码、查询串、片段、生成接口完整地址或远程 HTTP 地址
- **THEN** 保存被拒绝并明确反馈，已保存配置不被部分覆盖

#### Scenario: 本机测试目标

- **WHEN** 使用者填写回环 HTTP 地址且端口不是代理自身端口，地址为合法 API 根路径
- **THEN** 允许该配置用于本地 stub 测试，认证仍只透传而不记录

#### Scenario: 禁止代理指向自身

- **WHEN** 目标通过标准 URL 规范化后指向 `127.0.0.1:8788`，或使用 `localhost:8788`、`[::1]:8788` 等本机自身写法
- **THEN** 配置被拒绝，不形成自我转发循环

#### Scenario: 认证目标提示

- **WHEN** 使用者编辑 API 地址
- **THEN** 页面显示认证头会被发送给所填目标的提示，用户无需在插件页重复填写 API Key

### Requirement: 不自动降档或额外重试

插件 SHALL 保留上游状态码和响应体，SHALL NOT 因上游拒绝档位而删除该字段、改用另一档位或自动重发请求，SHALL NOT 跟随上游重定向改投其它站点。插件 SHALL NOT 修改 DSH 原有重试策略，SHALL NOT 根据响应档位或速度宣称 Fast 已实际生效。

#### Scenario: 上游拒绝档位

- **WHEN** 上游返回 400 及不支持档位的错误
- **THEN** 客户端收到原状态码和错误体，插件只发起原请求一次，不退回普通档

#### Scenario: 上游响应回显普通档

- **WHEN** 上游接受请求但响应回显 `default`
- **THEN** 响应原样透传，插件不改写回显、不额外请求、不报告已验证加速

#### Scenario: 上游返回重定向

- **WHEN** 上游返回带 Location 的重定向响应
- **THEN** 插件透传该响应，不自行跟随重定向并向另一目标发送认证头
