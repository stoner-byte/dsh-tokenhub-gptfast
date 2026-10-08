# Tasks

## 1. 统一插件标识与重新安装说明

- [x] 1.1 更新 [包清单](<package.json>)、[锁文件](<package-lock.json>)、[bundle](<cordis.patch.yml>)、宿主导出和浏览器模块/配置绑定，全部使用 `dsh-tokenhub-gptfast`；不增加旧名称兼容层。验证：导入宿主后名称正确，检查 bundle 的 id/name 相同，浏览器绑定为 `dsh-tokenhub-gptfast#dsh-tokenhub-gptfast`，`npm pack --dry-run --json` 包含宿主、客户端和 bundle，活动代码无旧标识。
- [x] 1.2 同组更新 [README](<README.md>) 的名称、安装与卸载命令、重新安装边界。验证：新包名一致，不含旧配置导入步骤；明确先恢复直连再卸载旧代理，新旧不能并占 8788，不承诺未经管理工具结果确认的热安装。

## 2. 配置、目标校验与转发路径

- [x] 2.1 在 [宿主](<lib/index.js>) 增加 volatile `upstreamBaseURL` 和 `tier`，将 `enabled` 默认改为 false，模型默认仍为两个现有 ID；正式出口只来自配置，去掉旧环境变量和 TokenHub 默认兜底。验证：更新 [注入测试](<test/inject.test.js>) 的四字段默认与 volatile 断言；用 [代理测试](<test/proxy.test.js>) 证明空地址在开启/关闭时都返回配置错误且 stub 未收到请求，旧环境变量也不能提供出口。
- [x] 2.2 实现宿主 URL 校验和配置错误处理，允许 HTTPS 与非自身的本机 HTTP 测试目标，拒绝用户信息、查询串、片段、非 HTTP(S)、远程 HTTP、完整生成接口 URL 和回环 8788。验证：同组本地测试覆盖合法配置、规范化回环自身写法及上述拒绝项；无效运行配置返回 503 且不发出认证头、不抛未捕获异常。
- [x] 2.3 修改共享转发路径构造，将本机 `/v1/` 后的接口相对路径映射到上游 API 根路径，保留查询串、固定目标主机与 Host，拒绝越出前缀的规范化路径。验证：本地 stub 检查带路径前缀、末尾斜杠、无 `/v1` 根路径、查询串的目标；更新原 `/v1/../../evil` 用例为拒绝，并守住绝对请求行、协议相对地址和路径白名单。
- [x] 2.4 将四字段 accessor 读取和模型集合复制放在请求开始，整次请求只用该快照。验证：用两个本地 stub 和 Promise 门闩，分别在上传 body 中与 SSE 返回中修改地址、档位和白名单；旧请求继续使用旧快照，新请求使用新配置，server 实例不重挂，不使用 sleep 猜时序。
- [x] 2.5 同组更新 [README](<README.md>) 的 API 地址填写、路径映射、HTTPS/认证安全、空地址错误说明。验证：文档中的映射示例与 2.3 测试一致，没有把完整生成 URL 当作 baseURL，也没有默认发送到旧 TokenHub 的说明。

## 3. 双接口档位注入与响应透传

- [x] 3.1 扩展现有 `injectTier` 接受所选档位，继续按模型 ID 精确匹配并保留已有字段和原 Buffer。验证：扩展 [注入测试](<test/inject.test.js>)，检查 fast/priority、无 gpt 的别名、空名单、未命中、已有 default/非法值/null、非 JSON 和非对象；不新增模型类型判断。
- [x] 3.2 用解析后的 pathname 精确判断两个 POST 生成接口，查询串不影响判断，两条路径共用注入和转发实现。验证：扩展 [代理测试](<test/proxy.test.js>)，覆盖 Responses/Chat Completions、查询串、关闭态、非 POST、models 接口、子路径和相近前缀；非目标请求体字节保持一致，Chat 消息不被改成 Responses 格式。
- [x] 3.3 保留原认证、Host、Content-Length、identity encoding 和 SSE 转发；不添加降档、重试或重定向跟随。验证：复用并扩展本地 stub 检查首块及时到达、认证头一致、上游 400/错误体和 default 回显不变；重定向不请求第二个目标，单个错误请求只有一次上游调用，连接失败仍有 502 边界。
- [x] 3.4 同组更新 [README](<README.md>) 的接口范围、档位选择与行为限制。验证：明确只请求档位，不保证实际选档、速度或费用；没有“仅凭模型名识别 GPT”、自动回退、WebSocket、测速或统一收费倍数的承诺，旧观测只作为有条件的历史记录。

## 4. GUI 保存与局部重置

- [x] 4.1 扩展 [配置页](<lib/client.js>)，增加 URL 输入和原生档位 select，为所有控件提供可访问名称，沿用主题 token 和中英文文案；默认开关显示关闭。验证：`node --check lib/client.js` 通过；在 4.4 的真实页面检查四个字段、默认两个模型、认证目标提示与键盘标签，不只凭模块加载成功判定 UI 通过。
- [x] 4.2 实现地址/模型/档位草稿与统一保存，开关单独即时提交；恢复默认只 unset enabled/models/tier，保留已保存地址。失败反馈、revision 和重复提交保护沿用 Host 表单，不另建设置 Service。验证：4.4 检查未保存草稿不改变请求、开关不捎带保存草稿、保存一次提交三个字段、校验/提交失败不报告成功、重置后无旧草稿覆盖且 API 地址不丢失。
- [x] 4.3 同组更新 [README](<README.md>) 的 GUI 操作顺序与重置说明。验证：先配置并保存上游，再手动改原提供商为本机代理，最后按需开关；恢复默认明确保留地址、恢复两个默认模型和 fast，不再称为删除整块 config。
- [x] 4.4 在另获用户授权的安装验证阶段，核实目标 profile 与 8788 归属，再按重新安装流程验证新版 GUI。验证：记录管理工具 application/warnings，确认新实例和配置入口；用本地 stub 或测试提供商验证保存热生效、开关透传、局部重置、重启后持久化和错误反馈；恢复测试改动，不迁移旧配置、不动共享凭据、不杀未知监听者。未获授权或未实际验证时保持此项未完成，明确记录限制。

## 5. 跨模块收尾验证

- [x] 5.1 完成整体复验：`npm test`、`node --check lib/index.js`、`node --check lib/client.js`、`npm pack --dry-run --json` 与 `openspec validate generalize-gpt-fast-proxy --strict`。验证：所有检查通过，包中有完整宿主/客户端/bundle，两个接口仍保持字节、认证与流式契约，不依赖真实额度或新测试框架。
- [x] 5.2 复核范围和验收记录。验证：没有新增依赖、旧名称兼容、配置迁移、端口配置或多站映射；没有修改 DSH/中转站源码、共享凭据和未经许可的提供商配置；将实际安装/GUI 验证结果与未执行项如实记入本清单，不把吞吐或 default 回显当作 Fast 生效证明。

## Workflow follow-up

- 规划交付后停止，等待新的 `/openspec-apply-change generalize-gpt-fast-proxy` 请求再实现。
- 实现与验收完成、用户评审通过后，另行同步主规格并归档；当前规划不执行同步、归档、安装或 Git 提交。
