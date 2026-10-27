# 代码审查（0.3.2 → 0.3.3）

面向 WhatsApp Web 上的中文客服 / 私域聊天。下面只列会在真实值班里踩到的问题。0.3.3 加了诊断日志，方便用真实失败来排这些项；除日志挂钩和错误文案脱敏外，没有改翻译行为。

日志实现：`diagnostics.js` 环形缓冲最多 400 条，ISO 时间，键名 `wbtDiagLog`。内容脚本经 `diagLog` 交给 service worker 单写者；弹窗「日志」可筛选、复制全部、清空。原文、API Key、`Authorization` 和请求体不会入库。

## 1. 谷歌等机器翻译没有超时，国内网络会卡住整条气泡队列

`fetchAI` 有 25 秒超时，`translateWithGoogleChunk`、`translateWithGoogleRpc`、`translateWithMyMemory`、`translateWithMicrosoftEdge`、`translateWithDeepL` 的 `fetch` 没有 `AbortSignal`。客服网络访问 `translate.googleapis.com` / `translate.google.com` 时经常既不成功也不马上失败。气泡并发只有 3（`MAX_CONCURRENT_BUBBLE_TRANSLATIONS`），挂住的请求会占满队列，微软或 DeepSeek 备用要等这次返回后才开始。

建议：机器翻译 8 秒左右中止并记为该引擎失败，让 `translateWithFallback` 继续下一家；AI 仍用 25 秒。超时在日志里记为 `translate.timeout`（AI 路径现在已经会这样记）。

## 2. MyMemory 额度警告会被当成译文发给客户

`translateWithMyMemory` 只看 `responseStatus === "200"`。免费额度用尽时，接口仍可能返回 200，正文是 `MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS...`。`firstSuccessfulTranslation` 让网页谷歌和 MyMemory 竞速，谁先返回非空字符串就采用。警告文本会进气泡，开启「翻译完成后直接发送」时还会发出去。

建议：匹配 `MYMEMORY WARNING`、`QUERY LENGTH LIMIT`、`INVALID LANGUAGE PAIR` 时抛错，不要当成功。0.3.3 只打 `translate.suspicious_result`（`code=mymemory_quota`，60 秒采样一次），行为未改。

## 3. `https://*/*` 加上同步存储里的 API Key，密钥面太大

`manifest.json` 的 `host_permissions` 在已知翻译域名之外还有 `https://*/*`。Service worker 因此可以向任意 HTTPS 发请求。密钥在 `chrome.storage.sync` 的 `settings.providers.*.apiKey` 里，会跟 Chrome 账号同步，客服共用电脑或同步账号时会带走 DeepSeek / OpenAI / Grok 密钥。

建议：内置引擎保留明确域名。自定义 OpenAI 兼容地址不要直接删掉 `https://*/*`（本地网关、豆包、反向代理的 host 不固定）。保存引擎时用 `chrome.permissions.request` 只申请该 `baseUrl` 的 origin，并继续允许 `http://127.0.0.1` 与 `http://localhost`。密钥改放 `chrome.storage.local`（或 session），同步项只留非机密配置。这次没有收紧权限，避免未做 origin 申请时自定义接口直接失效。

## 4. Gemini 把 API Key 放在查询串里

`listModels` 和 `translateWithGemini` 使用 `?key=`。密钥会出现在服务工作进程的网络日志、公司代理和报错 URL 里。诊断日志会把 `key=` 和 `AIza` 打成 `[redacted]`，但请求本身仍然带密钥。

建议：改成请求头 `x-goog-api-key`。`sanitizeHttpDetail` / `formatTranslationError` 在诊断模块加载后会再脱敏一次，避免 401 正文把密钥显示在输入框上方。

## 5. 缓存一次清空，冷却只活在内存里

`trimCacheSoon` 在 `chrome.storage.local` 超过 4MB 时删掉全部 `tr:` 键，没有按旧到新淘汰。忙了一天的会话会在同一时刻全部打回付费接口。`providerCooldowns`、`googleDirectCooldownUntil`、`googleRpcCooldownUntil` 是 service worker 内存。扩展进程一睡，429 冷却丢失，下一句又打被限流的引擎。

建议：只删最旧的一批 `tr:` 键。冷却结束时间写入 `chrome.storage.session`。不要对 local 做 `clear()`：客户资料、常用语和 `wbtDiagLog` 都在里面。清理失败现在记为 `cache.cleanup_failure`，单条写缓存失败记为 `cache.write_failure`，译文本身仍会返回。

## 6. 找不到发送按钮时，连续失败没有产品层信号

`triggerNativeSend` 依赖页脚里的发送按钮。WhatsApp 改版或按钮尚未渲染时返回 false。翻译成功的分支只把提示写成「译文已填入，请点击发送」；已经是目标语言时，以前连这句都没有，Enter 像是没反应。客服会连按 Enter，译文停在输入框里。

建议：连续两次失败时在输入框上方明确写「找不到发送按钮，请手动发送」，并在短时间的 DOM 变化后再找一次按钮。0.3.3 已记录 `composer.send_failure` 和 `composer.send_repeated_failure`（同一会话内计数，切换会话归零），并在「已是目标语言但没点到按钮」时改提示为「未能触发发送，请手动点击发送按钮」。写回失败记为 `composer.write_failure`。

## 7. 接口错误原文可能进到客户看得见的提示里

`buildHttpErrorFromDetail` 把供应商返回的最多 180 字拼进错误，显示在气泡和输入框提示上。部分网关会在 401/403 正文里回显密钥或请求片段。截图、投屏、同事看屏幕时会泄露。

建议：展示前走和诊断日志同一套脱敏（`sk-`、`xai-`、`AIza`、`Bearer`、`DeepL-Auth-Key`、`apiKey=`、`?key=`）。0.3.3 在诊断脚本已加载时对 `sanitizeHttpDetail`、`getErrorMessage` 和 `formatTranslationError` 做了这一步。诊断脚本没载入时保持原样，避免单测环境行为变化。
