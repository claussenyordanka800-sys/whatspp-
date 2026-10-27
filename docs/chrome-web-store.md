# Chrome 网上应用店文案与 GitHub 简介

文案对应扩展版本 **0.3.3**，权限与 [manifest.json](../manifest.json) 一致。上架前请再核对开发者信息中心里的表单字段，商店界面偶尔会改字数限制。

## 建议的 GitHub 仓库简介（350 字符以内）

下面这段为 **327** 个字符，可直接粘贴到仓库 Description：

```
WhatsApp翻译无忧 (WhatsApp Bubble Translator): Chrome MV3 extension that translates WhatsApp Web messages inside chat bubbles. Supports Google, Microsoft, DeepSeek, Grok, DeepL, Gemini, Doubao, and OpenAI-compatible APIs, plus an AI reply assistant. Text is sent only to providers you enable; no chat data is stored on our servers.
```

Homepage 建议先用仓库地址，商店链接出来后再改：

`https://github.com/claussenyordanka800-sys/whatspp-`

Topics（全小写）：

`chrome-extension` `manifest-v3` `whatsapp` `whatsapp-web` `translation` `translator` `i18n` `openai` `deepseek` `grok` `deepl` `gemini`

本环境的 `gh` 只能读取，不能改可见性、简介或 topics。仓库当前为 **Private**。公开并写上简介需要仓库管理员执行，例如：

```bash
gh repo edit claussenyordanka800-sys/whatspp- \
  --visibility public \
  --accept-visibility-change-consequences \
  --description "WhatsApp翻译无忧 (WhatsApp Bubble Translator): Chrome MV3 extension that translates WhatsApp Web messages inside chat bubbles. Supports Google, Microsoft, DeepSeek, Grok, DeepL, Gemini, Doubao, and OpenAI-compatible APIs, plus an AI reply assistant. Text is sent only to providers you enable; no chat data is stored on our servers." \
  --homepage "https://github.com/claussenyordanka800-sys/whatspp-" \
  --add-topic chrome-extension --add-topic manifest-v3 --add-topic whatsapp \
  --add-topic whatsapp-web --add-topic translation --add-topic translator \
  --add-topic i18n --add-topic openai --add-topic deepseek --add-topic grok \
  --add-topic deepl --add-topic gemini
```

公开之后，隐私政策网址可用：

`https://github.com/claussenyordanka800-sys/whatspp-/blob/main/docs/PRIVACY.md`

## 商店链接占位

上架后把真实地址替换到 README 和仓库 Homepage。占位：

`https://chromewebstore.google.com/detail/TODO-whatsapp-bubble-translator`

## 扩展名称

主名称（与 manifest 一致，建议商店也用这个）：

**WhatsApp翻译无忧**

可选英文副标题（仍低于 75 字符上限）：

**WhatsApp翻译无忧 - Bubble Translator**

详细说明里写明：本扩展独立开发，与 WhatsApp 或 Meta 无关。

## 简短说明（每种语言各自不超过 132 字符）

中文（75）：

```
在 WhatsApp 网页版聊天气泡内翻译消息。支持谷歌、微软、DeepSeek、Grok、DeepL、Gemini、豆包及 OpenAI 兼容接口。
```

英文（123）：

```
Translate WhatsApp Web messages inside the chat bubble. Supports Google, DeepSeek, Grok, DeepL, and OpenAI-compatible APIs.
```

manifest 里的说明是给 `chrome://extensions` 看的，与商店简短说明可以不同。当前 manifest 说明：

```
在 WhatsApp 网页版气泡内翻译消息。支持谷歌、微软、DeepSeek、Grok、DeepL 及 OpenAI 兼容接口。
```

## 详细说明

### 中文

WhatsApp翻译无忧在 WhatsApp 网页版的原有聊天气泡里显示译文，原文仍然保留。它适合需要中外文客户沟通的场景。本扩展由独立开发者维护，与 WhatsApp 或 Meta 无关，也不是 WhatsApp 官方功能。

你可以：

- 自动翻译收到和发出的文字消息，译文显示在同一气泡内
- 按 Enter 先译入输入框、再按 Enter 发送，或在输入时翻译；也可在翻译完成后直接发送
- 为每个客户记住语言，并查看地区、货币和当地时间；常用语可一键填入草稿
- 调整译文颜色和字号
- 按优先级排列多个引擎：谷歌翻译、微软翻译、DeepSeek、Grok（xAI）、DeepL、OpenAI、豆包、Gemini，以及任意 OpenAI 兼容接口（含本机服务）
- 使用 AI 助手生成回复建议或润色草稿。结果先预览，确认后才填入，不会自动发出

开始使用：安装后打开 https://web.whatsapp.com/ ，点击扩展图标，打开翻译开关。需要密钥的引擎请在「引擎设置」中填写自己的 API 密钥、接口地址和模型，先测试再保存。不要把密钥发给他人，也不要提交到公开仓库。

隐私：聊天文本会发送到你启用的翻译服务（谷歌与微软默认开启；谷歌失败时可能同时请求 MyMemory）。作者没有服务器，不在自己的服务器上保存聊天记录，也不出售数据。密钥和客户语言保存在浏览器扩展存储中；若开启了 Chrome 同步，设置可能随浏览器同步。完整说明见仓库中的 docs/PRIVACY.md。

翻译质量取决于所选服务和模型。请在发送前核对价格、交期和其他承诺。AI 助手不会编造这些事实，但生成内容仍需人工确认。

### English

WhatsApp Bubble Translator (WhatsApp翻译无忧) shows translations inside the original WhatsApp Web chat bubble and keeps the source text. It is an independent project and is not affiliated with WhatsApp or Meta.

- Translate incoming and outgoing text in place
- Press Enter to translate, then Enter again to send; or translate while typing; optionally send as soon as the translation is ready
- Remember each contact's language, show region, currency, and local time, and insert saved quick phrases
- Choose translation color and type size
- Order fallback engines: Google, Microsoft, DeepSeek, Grok (xAI), DeepL, OpenAI, Doubao, Gemini, and any OpenAI-compatible endpoint, including a local server
- Ask the AI assistant for a reply suggestion or a polished draft. Nothing is sent until you insert the text yourself

Open https://web.whatsapp.com/ and turn the extension on. Engines that need an API key use the key, base URL, and model you save in engine settings. Do not commit keys.

Message text is sent to the providers you enable. Google and Microsoft are on by default; a failed Google request may also be sent to MyMemory. The author stores no chat data on a server and does not sell data. Settings, including API keys, stay in Chrome extension storage and may sync with your Google account if Chrome Sync is on. See docs/PRIVACY.md.

Check prices, dates, and promises before you send. The assistant is instructed not to invent them; you still need to review the draft.

## 分类

建议：**生产力 / Productivity**。

若表单里有「沟通 / Communication」，生产力更贴近“翻译工作台”，沟通更贴近聊天工具。优先选生产力。

## 单用途说明（可粘贴）

```
在 WhatsApp 网页版的聊天气泡内翻译消息，并提供由用户主动触发的 AI 回复草稿、客户语言和常用语。不读取 WhatsApp 以外的网站，也不上传数据到扩展作者的服务器。
```

## 权限说明（与 manifest 一致，可粘贴）

扩展权限只有 `storage`。其余都是主机权限。

### storage

保存翻译开关、语言、样式、引擎顺序、接口地址、模型和 API 密钥（`chrome.storage.sync`，可能随 Chrome 同步）。在 `chrome.storage.local` 保存译文缓存、每个会话的语言/地区/时区、常用语，以及不含原文和密钥的诊断日志。不向作者的服务器上传这些数据。

### https://web.whatsapp.com/*

在 WhatsApp 网页版注入内容脚本，读取当前聊天的文字消息，把译文写进气泡，并在输入框上方提供语言、常用语和 AI 助手。不匹配其他网站。

### https://translate.googleapis.com/* 与 https://translate.google.com/*

把待译文本发给谷歌翻译直连接口；直连失败时改走 Google 翻译网页入口。

### https://api.mymemory.translated.net/*

仅作为谷歌引擎的备用翻译。谷歌直连失败时，同一段文本可能并行发给 MyMemory。

### https://edge.microsoft.com/* 与 https://api-edge.cognitive.microsofttranslator.com/*

微软翻译：先向 edge.microsoft.com 取得不含正文的短期授权，再把待译文本发给微软翻译接口。

### https://api.deepseek.com/*

用户启用 DeepSeek 并填写密钥后，向 DeepSeek 发送待译文本、模型列表请求或接口测试。

### https://api.x.ai/*

用户启用 Grok 并填写 xAI 密钥后，向 xAI 的 OpenAI 兼容接口发送待译文本或 AI 草稿请求。

### https://*/*

DeepL、OpenAI、豆包、Gemini 和用户自填的 OpenAI 兼容接口地址不固定，例如 `api.openai.com`、`api.deepl.com`、`api-free.deepl.com`、`generativelanguage.googleapis.com`、`ark.cn-beijing.volces.com`，以及用户自己的 HTTPS 网关。扩展只在用户保存并启用该引擎时，向该地址发送翻译、测试或模型列表请求。内容脚本不会注入这些网站。

审核时这项宽主机权限最容易被问到。它是为了支持用户自行填写的接口地址。如果审核要求收窄，需要改成一份明确的服务商清单，并接受“自定义 HTTPS 地址”不再可用，除非改用 optional host permissions。当前版本故意保留 `https://*/*`，否则已有的自定义引擎会失效。

### http://127.0.0.1/* 与 http://localhost/*

允许把文本发给用户本机的 OpenAI 兼容服务（默认示例 `http://127.0.0.1:8000/v1`）。不访问局域网里的其他机器。

## 数据披露建议

Chrome 开发者信息中心里的 “collect” 通常指数据离开用户设备。按本扩展的行为，建议勾选：

- **个人通讯 / Personal communications**：是。消息文本会发给用户启用的翻译或 AI 服务。
- **网站内容 / Website content**：是。扩展读取 WhatsApp 网页版上的消息文本并送去翻译。
- **身份验证信息 / Authentication information**：是。用户填写的 API 密钥会发给对应服务商；密钥也在 `chrome.storage.sync` 中，Chrome 同步开启时可能进入用户的 Google 账号。

建议不勾选：健康、财务支付、地理位置、浏览历史、用户活动。电话号码和聊天标题只留在本地客户资料里，扩展不会把号码发给翻译接口。地区是用户选择或根据号码在本地推测的，没有 GPS。

同时确认三项承诺：不出售或转让用户数据；不把数据用于扩展单用途以外的目的；不用于信用评估。

这是根据当前代码整理的填表建议，不是法律意见。

## 图标

manifest 已包含 16、32、48、128 像素 PNG，以及矢量源文件 `assets/icons/icon.svg`。图案是紫色底上的白色气泡和「译」，不是 WhatsApp 商标图形。128 像素图标可作商店图标。

弹窗标题旁仍使用 `assets/logos/whatsapp.svg` 作为聊天产品标识。若审核认为该图形过于接近 WhatsApp 商标，需要另做一版界面标识；本次未改动可用的界面代码。

重新生成 PNG：`npm run icons`（需要本机的 Pillow 和文泉驿微米黑字体）。

## 截图与图注

现有预览图可以直接放进 README。商店要求截图尺寸通常是 **1280×800** 或 **640×400**，且不要透明通道。下面这些文件尺寸都不符合，上传前需要加边框或重截，不要拉伸。

| 文件 | 当前尺寸 | 图注（中文） | Caption (English) |
| --- | --- | --- | --- |
| [popup-preview.png](../popup-preview.png) | 430×760 | 扩展弹窗：翻译开关、引擎、收发语言、回车翻译和译文样式 | Popup with the translate switch, engine, languages, Enter-to-translate, and style controls |
| [engine-settings-0.3.1.png](../engine-settings-0.3.1.png) | 1100×900 | 引擎设置：拖拽排序、启用开关，以及 API 密钥、接口地址和模型 | Engine settings: drag to reorder, enable toggles, API keys, endpoints, and models |
| [chat-tools-preview.png](../chat-tools-preview.png) | 1200×1000 | 气泡内保留原文并显示紫色译文；输入框上方有客户地区、常用语和 AI 助手 | In-bubble translation, with customer region, quick phrases, and the AI assistant above the composer |
| [ai-assistant-0.3.1.png](../ai-assistant-0.3.1.png) | 1100×900 | AI 回复助手先给出可编辑预览，确认后才填入草稿，不会自动发送 | AI reply preview: edit the draft, then insert it yourself; nothing is sent automatically |
| [tests/error-recovery-0.3.2.png](../tests/error-recovery-0.3.2.png) | 1280×720 | 开发预览：翻译失败时保留原文，并提供重试和恢复原稿。这是模拟页面，不建议直接当商店截图 | Dev preview of a failed translation with retry and restore. Simulated page; skip it for the store listing |

商店建议至少使用前四张，并先做成 1280×800。`tests/error-recovery-0.3.2.png` 是测试夹具里的模拟界面。

## 打包

在仓库根目录执行：

```bash
npm run pack
```

需要系统里有 `zip`。产物为 `dist/whatsapp-bubble-translator-0.3.3-chrome-web-store.zip`（版本号随 package.json 变化）。压缩包只包含 manifest、脚本、弹窗和 `assets/`，不含 tests、docs、预览图、markdown 和 node_modules。`dist/` 已被 .gitignore 忽略。

上传前用「加载已解压的扩展程序」试开该 zip 里的文件，确认版本为 0.3.3，再在已登录的 WhatsApp 网页版上看气泡翻译。
