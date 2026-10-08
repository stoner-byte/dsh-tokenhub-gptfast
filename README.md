# dsh-tokenhub-fast

让 DSH 发往 TokenHub 的白名单模型请求带上 `service_tier: "fast"`,请求快速档。2026-10-08 的 `gpt-6.1-sol` 对照测试中,两组输出速率中位数之比约 1.4 倍;不保证固定加速倍数或上游实际采用的档位。

不改 TokenHub,不改 DSH 源码,只用公开的插件接口。

## 原理

TokenHub 只从**请求体**读 `service_tier`,没有 header 开关,pi-ai 路由配置里也没有"往请求体加字段"的口子。所以插件在 DSH 宿主进程内起一个回环代理:

```
DSH (pi-ai 路由)  ->  127.0.0.1:8788  ->  https://token.yoso-ai.com
```

代理只对命中的请求补一个字段,其余请求原样转发。

## 安装

```bash
dsh plugin --profile <你的 profile> add /Users/stoner/code/dsh-tokenhub-fast
```

也可以在 GUI 的插件页安装本地包。安装结果若为 `applied`,无需重启;若为 `restart-required`,按提示重启 DSH。代理挂载成功时日志会出现一行:

```
dsh-tokenhub-fast: listening on 127.0.0.1:8788 -> https://token.yoso-ai.com; the route baseURL must be http://127.0.0.1:8788/v1 (fast on, models: ...)
```

## 配置

两步,都在界面里,不用改配置文件。

**第一步:把路由指向代理。** 打开 **设置 → 模型**,编辑 `tokenhub` 提供商,在 **自定义设置** 里把 `API 地址` 改成 `http://127.0.0.1:8788/v1`(`API 地址` 默认折叠,要先展开「自定义设置」)。

**第二步:按需开关。** 打开 **插件**(左侧边栏)→ **dsh-tokenhub-fast** → 行 `tokenhub-fast-proxy` 的 **配置**:

| 配置项 | 默认 | 含义 |
|---|---|---|
| `enabled` | 开 | 总开关,关掉就不再注入任何字段 |
| `models` | `gpt-6-sol`、`gpt-6.1-sol` | 只有这些模型注入 `service_tier`,一行一个 |

改动立即生效,不用重启。写入落在 profile 补丁的该插件行(`config:`),重启后仍生效;点 **恢复默认** 会移除这层覆盖。关掉开关时,请求体字节不变,仍经过代理,不会切回直连;请求原本已带的档位也保留。请使用配置页的开关,不要用 bundle/插件行的禁用开关代替,后者会关闭代理。

开关只在**插件页**出现:**设置 → 内置插件** 是只读清单,那里看不到可编辑项。

## 计费

[OpenAI Codex 官方 Speed 文档](https://developers.openai.com/codex/agent-configuration/speed#fast-mode)与[Codex 定价页](https://developers.openai.com/codex/pricing)规定,支持模型的 Fast 模式相对普通档:

- 订阅内含的使用额度按 **2.5 倍**消耗。
- 购买的 credits 与 Enterprise 按量付费按 **2 倍**计费。

这是 **OpenAI Codex 上游账户**的规则,不是生成 token 数增加 2.5 倍,也不是速度倍数。**TokenHub 对你的余额或额度如何计费、这些测试实际扣减多少,尚未核实**,不能直接套用上述倍数。OpenAI API 的价格另有模型价目表。

关闭开关只停止插件注入;请求原本已显式包含的 `service_tier` 会被保留,不会被删除。

## 适用范围

本版本的验证范围是 TokenHub 转 Codex 上游的 GPT 模型。Kimi 等其它模型不在默认白名单内,因此不会被注入。其它上游的档位支持和性能收益未在本版本验证,不要未经测试就加入白名单。

## 验证与测速

插件的行为验收是:命中条件时请求体增加 `service_tier: "fast"`;关闭开关或非目标请求时不改请求体;显式档位保留;上游响应及时透传。`npm test` 使用本地 stub 检查这些行为,不消耗真实额度。

### 2026-10-08 线上对照

直接请求 TokenHub,使用同一个 `gpt-6.1-sol` 模型、同一提示和 `reasoning.effort: "low"`,只改变请求体的 `service_tier` 为 `default` 或 `fast`。两组各 4 次,按普通/快速、快速/普通交替执行;八次命中同一 Codex 账号和路由,均返回 200,没有重试。

速率口径:扣除 reasoning 后的输出 token 数,除以首个到最后一个非空正文 delta 的时间。每次为 221–243 个非 reasoning 输出 token,不包含首字等待时间。

| 轮次 | 请求 `default` | 请求 `fast` | 速度比 |
|---|---|---|---|
| 1 | 36.0 tok/s | 44.7 tok/s | 1.24 |
| 2 | 32.4 tok/s | 41.6 tok/s | 1.28 |
| 3 | 31.9 tok/s | 45.5 tok/s | 1.43 |
| 4 | 31.6 tok/s | 46.7 tok/s | 1.48 |
| 各档中位数 | 32.2 tok/s | 45.1 tok/s | 1.40 |

各轮配对速度比的中位数为 **1.35**。这是本轮的小样本性能观测,不是保证稳定 1.5 倍,也不是整段回答总耗时的倍数。

### 档位回显的已知限制

本轮八次请求的最终响应均回显 `default`。另外的短请求检查中,直连的 `fast`、`priority` 和经过插件的请求也都返回 200 / `default`;非流式 `fast` 响应同样如此。无效档位触发 `codex_upstream_error` / 400,说明该字段到达上游校验。

同版本 TokenHub 源码没有把档位限制为三个值,也没有在核心响应路径把它固定为 `default`;Codex 适配器将 `fast` 转成 `priority` 后发送。**这些观察不能证明上游实际按快速档服务**,尚不能区分普通档处理与档位回显问题。使用者已接受将此问题暂留为已知限制;插件负责请求字段,不保证上游选档。不能把本轮观察推广成「恒返回 default」,也不能只凭变快就忽略响应档位。

### 历史观测

早期测量的对照是「直连、不传档位」对「经过代理、注入 fast」,不是在同一代理内切换开关: `gpt-6.1-sol` 为 25.8 / 36.3 tok/s(各 4 次),`gpt-6-sol` 为 43.8 / 63.2 tok/s(各 3 次),`gpt-6-luna` 为 79.6 / 78.4 tok/s(各 4 次)。`gpt-6-luna` 在该轮未观察到收益,因此移出默认白名单,仍可手动加入。

scratch1 的完整 DSH 链路另测过 GUI 开关:同题、新会话,关闭时 32 / 29 tok/s,开启时 38 / 49 tok/s(各 2 次),均值之比约 1.43。历史提示和计时口径与当前测试不同,不合并为同一组统计,也不以单个绝对速率判定档位。

## 回滚

顺序不能颠倒:

1. 先在 **设置 → 模型 → tokenhub → 自定义设置** 把 `API 地址` 改回 `https://token.yoso-ai.com/v1`。这一步立刻恢复直连。
2. 再卸载插件:`dsh plugin --profile <你的 profile> remove dsh-tokenhub-fast`。

反过来做(先卸载)会让路由停在一个没人监听的端口上,该路由下所有模型都会失败。

只想临时停用、不改 baseURL 时,把开关关掉即可。

## 已知限制

- 代理是这条路由**所有**模型的单点。它和 DSH 同进程,DSH 退出就释放,不会留下孤儿进程。
- 端口固定 `8788`。被占用时插件只警告、不阻断 DSH 启动;这不保证指向该端口的 TokenHub 路由可用。不要向来源不明的端口监听者发送请求。
- 开关是 volatile 配置,写入由 Loader 原地提交,**不会**重挂插件,8788 不会因切换而断开。
- 只监听回环地址,只转发 `/v1/` 开头的路径,凭据只透传、不读取也不落盘。

## 开发

```bash
npm test
```

用 `node --test` 跑注入判定和代理转发的测试。测试用本地 stub 当上游,不消耗真实额度。

`DSH_TOKENHUB_FAST_UPSTREAM` 可以把上游指向别处,只给测试用;请求内容永远不能改变目标主机。
