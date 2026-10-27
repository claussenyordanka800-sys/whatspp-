# 隐私政策 / Privacy Policy

**WhatsApp翻译无忧**（英文名 WhatsApp Bubble Translator）  
版本 0.3.3 · 最近更新：2026-10-27

本扩展是安装在你自己浏览器里的 Chrome Manifest V3 扩展。作者不运营翻译服务器，不出售数据，也不在扩展里加入广告或统计代码。

This Chrome Manifest V3 extension runs in your browser. The author does not operate a translation server, does not sell data, and does not ship advertising or analytics in the extension.

公开仓库上架后，可将本文件作为 Chrome 网上应用店的隐私政策网址：

`https://github.com/claussenyordanka800-sys/whatspp-/blob/main/docs/PRIVACY.md`

仓库设为公开之前，该链接无法打开。联系方式：在上述仓库提交 [GitHub Issue](https://github.com/claussenyordanka800-sys/whatspp-/issues)。

## 我们不收集什么

- 没有作者自己的服务器，因此聊天内容不会上传到“我们的服务器”，也不会由作者保存。
- 扩展不出售、不出租、不交换用户数据，也不把数据用于广告、信用评估或与翻译无关的用途。
- 扩展不含第三方统计、崩溃上报或远程代码。
- 诊断日志不保存消息原文、API 密钥、Authorization 头或请求体。

## 会离开浏览器的数据

翻译和 AI 功能会把文本发给**你启用的第三方翻译服务**。谷歌翻译和微软翻译默认开启，不需要你填写密钥。使用谷歌引擎时，若直连失败，扩展会并行请求 Google 网页翻译入口和 [MyMemory](https://mymemory.translated.net/) 备用接口，因此同一段文本可能同时发给这两家。

| 场景 | 发送内容 | 接收方 |
| --- | --- | --- |
| 气泡翻译、输入翻译、接口测试 | 待译文本、目标语言；AI 引擎还会附带你填写的翻译要求（最多 1000 字） | 当前启用且被选中的引擎。按顺序失败时会尝试下一个已启用引擎 |
| 谷歌引擎回退 | 同上待译文本 | `translate.googleapis.com`、`translate.google.com`，以及备用的 `api.mymemory.translated.net` |
| 微软翻译 | 待译文本；另有一次不含正文的授权请求 | `api-edge.cognitive.microsofttranslator.com`、`edge.microsoft.com` |
| AI 建议回复 | 当前会话最近最多 8 条文字消息，以及目标语言和翻译要求 | 第一个配置完整的 AI 引擎（OpenAI 兼容接口或 Gemini）。谷歌、微软、DeepL 不用于生成 |
| AI 润色 | 当前草稿，而不是整段聊天记录 | 同上 |
| 获取模型 / 测试接口 | 密钥，以及一条很短的测试文本（测试时） | 你为该引擎填写的接口地址 |

密钥只发给对应服务商（放在 `Authorization`、`Api-Key` 或 Gemini 的 `key` 查询参数中）。自定义接口可以是任意 `https` 地址，或本机的 `http://127.0.0.1` / `http://localhost`。

这些服务商如何保存和训练数据，以其自己的条款为准，例如 Google、Microsoft、Translated/MyMemory、DeepSeek、xAI、DeepL、OpenAI、火山引擎（豆包）和 Google Gemini。请只启用你信任的引擎。

语言检测使用 Chrome 自带的 `chrome.i18n.detectLanguage`，在本地完成，不会为此把文本发给作者。

## 只保存在本机的数据

扩展使用 `storage` 权限。数据写在 Chrome 扩展存储中，不写入作者的服务器。

### `chrome.storage.sync`（设置）

包括开关、引擎顺序、启用状态、收发语言、译文颜色和字号、各引擎的接口地址、模型，以及 **API 密钥** 和 AI 翻译要求。

若你登录 Chrome 并开启了同步，Chrome 可能把 `chrome.storage.sync` 中的设置（含密钥）同步到你的 Google 账号。这是浏览器的同步功能，不是本扩展上传。不想同步密钥时，请关闭 Chrome 同步，或不要在同步开启时保存密钥。

### `chrome.storage.local`

| 键 | 内容 |
| --- | --- |
| `tr:` 开头 | 译文缓存。键含引擎、目标语言，以及原文、方向、接口、模型和翻译要求的哈希。值是译文全文。原文不另存明文 |
| `contact:<id>` | 客户语言、自动识别结果、地区和时区。`<id>` 优先是 WhatsApp 会话 ID（一对一私聊可能包含电话号码），页面没有 ID 时退回聊天标题 |
| `quickPhrases` | 常用语标题和正文（最多 100 条，每条最多 2000 字） |
| `wbtDiagLog` | 最多约 400 条诊断记录：时间、级别、引擎、状态码、方向、语言、文本长度和短哈希。复制或清空都在本地完成 |

本地存储超过约 4 MB 时，扩展会删掉 `tr:` 译文缓存，客户资料、常用语和诊断日志会保留。

号码推测地区和当地时间只在页面上计算，不把号码发给翻译接口。

## 你的选择

- 在弹窗关闭「翻译开关」，或关掉不需要的引擎。
- 不要把密钥填进不信任的自定义地址。
- 在弹窗「日志」里清空诊断记录。
- 在 `chrome://extensions` 中移除扩展，或清除该扩展的数据，可删除本地设置、缓存、客户资料和常用语。已经同步到 Google 账号的设置，需要在 Chrome 同步里另行处理。
- 卸载扩展不会删除你在各翻译服务商账号里已经产生的请求记录。

## 权限与页面访问

扩展只在 `https://web.whatsapp.com/` 注入脚本，用来读取当前聊天里的消息文本、把译文写回气泡和输入框。它不读取其他网站。`https://*/*` 以及本机地址权限只用于你配置的翻译接口，不是用来浏览或采集其他网页。

## 儿童

本扩展不面向 13 岁以下儿童，也不会故意收集儿童信息。

## 变更

政策变更会更新本文件顶部的日期，并出现在仓库提交记录中。继续使用新版本即表示你了解更新后的做法。

---

## English summary

WhatsApp Bubble Translator (WhatsApp翻译无忧) version 0.3.3 translates WhatsApp Web messages inside the chat. The author has no server and does not sell data.

**Sent off the device.** Message text, the target language, and any AI writing instructions you enter are sent to the translation providers you enable. Google Translate and Microsoft Translator are on by default and do not need an API key. If the direct Google call fails, the same text may also be sent to MyMemory. The AI assistant sends either the current draft (polish) or up to eight recent text messages (suggested reply) to the first ready OpenAI-compatible or Gemini provider. API keys are sent only to that provider. There is no analytics module.

**Stored locally.** Settings, including API keys, live in `chrome.storage.sync` and can be copied by Chrome Sync to your Google account if sync is on. Translation results, per-chat language/region/timezone, quick phrases, and redacted diagnostic logs live in `chrome.storage.local`. Diagnostics store length and a short hash, not the message text or the key. A chat id may be a WhatsApp JID containing a phone number, or the chat title. Clearing extension data deletes these local copies.

**Not done.** No sale of data, no ads, no author-operated archive of chats, and no remote code.

Questions: open an issue at <https://github.com/claussenyordanka800-sys/whatspp-/issues>.
