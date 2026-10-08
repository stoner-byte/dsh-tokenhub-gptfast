# dsh-tokenhub-gptfast

DSH 插件。它会在本机运行一个 API 代理，并按模型白名单为生成请求添加 `service_tier`（`fast` 或 `priority`），再转发到你配置的 API 上游。

## 安装

```bash
git clone https://github.com/stoner-byte/dsh-tokenhub-gptfast.git
cd dsh-tokenhub-gptfast
dsh plugin --profile <profile> add .
```

也可以从 DSH 的插件页面安装此项目。

## 使用

1. 在 DSH 插件页面打开 **dsh-tokenhub-gptfast** 的配置，填写上游 API base URL，并设置模型白名单和档位，然后保存。
2. 将 DSH 中对应提供商的 API 地址设置为 `http://127.0.0.1:8788/v1`。
3. 在插件配置中启用插件。

默认档位为 `fast`，默认模型白名单为 `gpt-6-sol` 和 `gpt-6.1-sol`。插件只为白名单内、符合条件的生成请求添加档位；其它请求正常转发。实际档位和计费由上游服务决定。
