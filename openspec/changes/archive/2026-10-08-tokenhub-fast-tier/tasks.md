# Tasks

## 1. 包骨架与 bundle 接线

- [x] 1.1 建 `package.json`:`name: dsh-tokenhub-fast`、`type: module`、`main`/`exports` 指向 `lib/index.js`、`files` 含 `lib` 与 `cordis.patch.yml`、`dsh.bundle.patch` 指向 `./cordis.patch.yml`。验证:`node -e "const p=require('./package.json');console.log(p.dsh.bundle.patch,p.exports['.'])"` 输出与文件一致。
- [x] 1.2 建 `cordis.patch.yml`,只插入一行代理条目(`id: tokenhub-fast-proxy`、`name: dsh-tokenhub-fast`),不含 `baseURL`。验证:用 loader 原生解析器读该文件(`ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' -e "…loadOverlayPatches('dsh','<绝对路径>')…"`),输出为 1 行且 id 正确。
- [x] 1.3 建 `lib/index.js` 骨架,导出 `name`、`Config`、`apply`。验证:`node --input-type=module -e "import('./lib/index.js').then(m=>console.log(m.name,typeof m.apply,typeof m.Config))"` 无报错。
- [x] 1.4 声明并安装 `@deepseek-ai/schemastery`。验证:`node --input-type=module -e "import('@deepseek-ai/schemastery').then(m=>console.log(typeof m.default))"` 输出 `function`;若 registry 上没有该包,改为 `file:` 引用 profile 内已有的副本(`~/.dsh/profiles/<profile>/node_modules/@deepseek-ai/schemastery`)并复验。

## 2. 注入逻辑与单元测试

- [x] 2.1 用 schemastery 声明 volatile `Config`:`enabled` 默认 `true`;`models` 默认 `['gpt-6-sol','gpt-6.1-sol']`。验证:Config 默认值与 volatile 标记由 `test/inject.test.js` 断言,读取默认值使用 accessor 的 `.get()`。原计划中的 `gpt-6-luna` 已按 5.3 的观测移出默认列表。
- [x] 2.2 实现 `injectTier(body)` 纯函数:JSON 对象且无 `service_tier` 时补 `"fast"`;已有值保留原值;非 JSON 或非对象时返回同一 Buffer 引用。验证:`node --test test/inject.test.js` 四个用例全过(注入、显式档位优先、非 JSON、数组与标量)。
- [x] 2.3 实现白名单命中判定(把 `models` 放进 `Set`),补一个"白名单外模型不被注入"的用例。验证:`node --test` 全过。

## 3. HTTP 代理与生命周期

- [x] 3.1 实现转发:方法、路径、请求头透传;`host` 固定为上游;`content-length` 按改写后长度重算;`accept-encoding: identity`;上游响应用 `pipe` 回写,不整体缓冲。验证:`node --test test/proxy.test.js` 的"SSE 分块及时到达"用例通过。
- [x] 3.2 上游地址可注入:读 `DSH_TOKENHUB_FAST_UPSTREAM`(默认 `https://token.yoso-ai.com`),按 URL protocol 选择 `http` 或 `https` 模块。验证:测试里把该变量指向本地 stub 后,stub 收到请求。
- [x] 3.3 加路径白名单:只转发路径以 `/v1/` 开头的请求,其余直接返回错误响应且不产生上游请求。验证:`test/proxy.test.js` 的 `/admin` 用例通过,且 stub 未收到任何请求。
- [x] 3.4 生命周期:`ctx.effect` 在 `apply()` 内**同步**注册;`server.on('error')` 在 `listen` 之前挂;`listen(8788,'127.0.0.1')`;disposer 调 `server.close()`。验证:scratch profile 启动后 `lsof -nP -iTCP:8788 -sTCP:LISTEN` 显示 DSH 进程;先用其它进程占住 8788 再启动,DSH 仍能起来且日志出现警告(不崩)。
- [x] 3.5 挂载时输出一行日志,回显监听地址与期望的 `baseURL`(含端口)。验证:启动日志中出现该行。

## 4. 插件页开关

- [x] 4.1 在 scratch profile 装 bundle:`dsh plugin --profile scratch1 add <本仓库绝对路径>`,并补上界面所必需的浏览器半边(`package.json` 的 `dsh.client` + `lib/client.js` 注册 `plugins.row.config`,`Config` 两个字段标 `.volatile()`)。验证:插件页 → **dsh-tokenhub-fast** → 行 `tokenhub-fast-proxy` 出现「配置」入口,页内含开关、模型白名单文本框与「保存模型列表 / 恢复默认」;设置 → 内置插件 只是只读清单,那里没有表单。
- [x] 4.2 验证改动落盘与热生效:在插件页把开关切到关。验证:profile 补丁出现 `- id: tokenhub-fast-proxy` + `config: enabled: false`,勾选随之取消,重启后启动日志回显 `fast off`;不重挂插件(volatile 原地提交),运行中的代理读取新值由 `test/proxy.test.js` 的 "follows a live volatile config without a remount" 用例守住。再点「恢复默认」后该覆盖被移除、勾选回到默认。关闭后的实际吞吐回落由 5.4 覆盖。
- [x] 4.3 写 README:安装与 GUI 配置、回滚顺序、请求快速档的行为边界、Codex 官方计费来源与适用范围。2026-10-08 收尾已删除「保证拿到 priority」「恒返回 default」与 TokenHub 必然按 2.5/2 倍收费的断言,补入当前四组测速与档位回显的已知限制。验证:历史 scratch1 流程通过 GUI 创建 OpenAI Responses 提供商并成功生成;使用者已在 desktop GUI 安装并修改 API 地址。自定义设置入口的内部展开未由自动化完整验证,不将其写成独立通过项。

## 5. 端到端验收

- [x] 5.1 经 DSH 路由发真实请求:scratch1 的 `tokenhub` 提供商 `baseURL` 指向 `http://127.0.0.1:8788/v1`,选 `gpt-6.1-sol` 发同一道题。验证:请求成功返回并流式出字(证明整条链路通),DSH 报 38 / 49 tok/s(两次,新会话各一次),用时 14 / 12 秒。计划里写的 55-62 tok/s 是估数,以实测为准。
- [x] 5.2 对照臂:历史 DSH 链路开关测试各两次,关闭时 29 / 32 tok/s、16 / 17 秒,开启时 38 / 49 tok/s,均值之比约 1.43。2026-10-08 补充直连 TokenHub 的受控对照:同提示、同模型、同账号/路由,显式 `default` / `fast` 各 4 次且交换顺序;正文速率中位数 32.2 / 45.1 tok/s,比值 1.40,配对比值中位数 1.35。历史与当前计时口径不同,不合并统计;不承诺稳定 1.5 倍,也不把速度差当作实际上游档位证明。
- [x] 5.3 按实测修正默认白名单:三个默认模型带上档位都返回 200,没有被拒。`gpt-6-luna` 无收益(经代理 78.4 / 直连 79.6 tok/s,各 4 样本),已从 `models` 默认值移除;默认值改为 `gpt-6-sol`、`gpt-6.1-sol`。验证:`node --test` 的 Config 默认值断言通过,规格与 design 已同步。
- [x] 5.4 关闭态对照(与 5.2 同一次实测):开关关闭后仍正常生成,该轮输出速率较开启组低。单元测试验证关闭时请求体字节不变、响应正常转发;不要求两次生成的文本相同,不由吞吐差异推断实际上游档位。
- [x] 5.5 desktop 启用:使用者已在 GUI 安装插件,将 `tokenhub.baseURL` 改为 `http://127.0.0.1:8788/v1`,并切换本会话到 `tokenhub/gpt-6.1-sol` 后完成真实生成。验证:读取 desktop 补丁确认地址;本机代理请求返回 200 并完成 SSE;2026-10-08 收尾时 `lsof -nP -iTCP:8788 -sTCP:LISTEN` 仍为 desktop DSH 进程 PID 74583。该验收证明链路可用,不证明上游实际服务档位。
- [x] 5.6 清理:2026-10-08 执行 `dsh plugin --profile scratch1 remove dsh-tokenhub-fast`,确认依赖和 bundle 都已移除,无 scratch1 Node/DSH 运行进程后,只删除核对过绝对路径的 `~/.dsh/profiles/scratch1`。验证:目录不存在;8788 仍仅由 desktop PID 74583 监听;desktop 的 package/补丁与全局凭据文件在本次清理前后 SHA-256 一致。共享会话与其它 profile 未清理。

## Workflow follow-up

- 按项目评审要求通过后,归档本 change。
