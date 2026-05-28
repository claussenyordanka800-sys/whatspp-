# WhatsApp Bubble Translator

Chrome MV3 plugin for translating WhatsApp Web messages inside the original chat bubble.

## 使用

1. 打开 Chrome：`chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本文件夹：`C:\Users\Administrator\Documents\私域聊单`
5. 打开 `https://web.whatsapp.com/`

## 功能

- 自动识别当前客户语言，并在输入框上方显示“当前场景语言”
- 可在 WhatsApp 输入框上方手动切换目标语言
- 客户消息和自己发出的消息都会默认自动翻译，不显示额外刷新按钮
- 译文显示在同一个气泡内，紫色，保留原文
- 输入框旁不显示翻译按钮，避免占用 WhatsApp 原生输入栏
- 设置页可调整译文字体大小：小、默认、大、特大
- 设置页可选择译文颜色
- 默认“回车翻译”：输入完整中文后按 Enter，先翻译成客户语言并填入输入框，不发送
- 翻译完成后再次按 Enter，才按 WhatsApp 原逻辑发送
- 设置页可切换为“输入时翻译”或“手动按钮翻译”
- 翻译后的发送内容只填入输入框，不自动点击发送
- 支持 Google、DeepSeek、第三方 OpenAI 兼容 API
- 新增免费火山翻译、DeepL、OpenAI、豆包、Gemini
- 设置页可对翻译引擎上移/下移排序，翻译时按排序优先级自动尝试
- 翻译引擎列表默认紧凑显示，点击齿轮按钮展开 API Key、接口地址、模型配置
- 支持“获取模型”：OpenAI 兼容接口和 Gemini 会读取可用模型供选择
- 支持“测试接口”：保存前可确认 API Key、接口地址、模型是否可用
- DeepSeek 已做专门兼容：Base URL 会自动规范为 `https://api.deepseek.com`，`/models` 获取失败会显示 401/403/404/429 等具体原因
- DeepSeek 模型为空时默认使用 `deepseek-v4-flash`，并提供 `deepseek-v4-pro`、`deepseek-chat`、`deepseek-reasoner` 作为备选

## 第三方 API 示例

本地 OpenAI 兼容服务：

- 接口地址：`http://127.0.0.1:8000/v1`
- 模型：按你的本地服务填写
- API Key：本地服务不需要时可留空

豆包 Ark 或其他云服务：

- 接口地址填到 `/v1` 或服务根路径均可，只要最终兼容 `/chat/completions`
- API Key 填对应密钥
- 模型填对应模型名
