# 最终修复版有界验收报告（修订版）— R1 / R2 / R3 / R4 / R6

- 验收对象：
  - `final`（0.3.2）：`E:\deepseek work\whatsapp-review-20261004\final` —— 用于 **R1 / R2 / R6**
  - `final-addendum`（0.3.2 + 一行 `event.data === ''` 兼容）：`E:\deepseek work\whatsapp-review-20261004\final-addendum` —— 用于 **R3 / R4**
- 对照：`patched`（0.3.1）、`baseline`
- 范围：**仅** R1/R2/R3/R4/R6。不新增研究线，不做无界插桩。
- 约束遵守：未修改任何快照源码；未向任何真实 WhatsApp 联系人发送消息；快照内只执行 `npm ci` / `npm test`
- 前序文档：[review.md](E:\deepseek work\whatsapp-review-20261004\review.md)（首轮）、[patch-review.md](E:\deepseek work\whatsapp-review-20261004\patch-review.md)（第二轮）

> **重要**：本文件是修订版。上一版 `final-review.md` 中 **R2「未达标」的判定是探针自身的错误**，R3 的部分结论也受探针缺陷污染，均已在本版更正并标注（第 2、3 节与第 6 节勘误表）。

---

## 0. 结论

| 项 | 判定 | 一句话 |
|---|---|---|
| **R1** | ✅ **已修复** | 部分落盘走完整错误路径：原稿保留、错误提示持续、三个动作按钮可点；真实用户编辑仍正确作废译文标记（未过度放宽） |
| **R2** | ✅ **已修复**（上一版判定作废） | 在途失效后**即时且持续**显示原因文案；上一版"未达标"由我方探针丢弃 `reason` 参数造成 |
| **R3** | ✅ **已修复**（在 `final-addendum` 上验证） | 忠实多行写入正常发送；截断写入**可见报错**并提供恢复；`data:null` 框架回声不再误判为用户编辑 |
| **R4** | ✅ **已修复**（在 `final-addendum` 上验证） | `恢复原稿` 存在且可用：点击后 `draft=中文原稿`、`calls` 不增加、`sends=0` |
| **R6** | ✅ **符合声明的取舍** | 可靠检测的外语可译成英语；可靠同目标跳过接口；英语默认下无法可靠检测的短拉丁文本保持原文 |

**测试执行（两侧均实测）**

```
final           → Input 60 passed / Composer 32 passed / Provider 7 passed
final-addendum  → Input 60 passed / Composer 33 passed / Provider 7 passed   （合计 100）
```

---

## 1. R1 — 已修复（含"不做无条件忽略"的边界）

`final` 实测（`_harness3\acceptance.mjs`）：

```json
"R1a_partialWrite": {
  "composer": "TRAN",
  "notice": "译文未能写入输入框，原文已保留在提示中，请重试",
  "statusHidden": false, "statusIsError": true,
  "buttons": ["重试翻译", "关闭提示", "恢复原稿"],
  "hasOriginalTextarea": true,
  "failedWriteSource": "中文原稿",
  "draftRequestNull": true, "isTranslating": false,
  "calls": ["中文原稿"]
}
"R1b_realEditDuringWrite": {
  "composer": "用户真实编辑", "notice": null, "marker": null,
  "failedWrite": null, "calls": ["中文原稿"]
}
"R1c_afterWriteSend": { "extraCalls": 0, "sends": 1, "composer": "TRANSLATED" }
```

对比第二轮（0.3.1）同一探针：`notice: null` / 无按钮 / `failedWrite: null` 的死局已消失。
**边界正确**：写入窗口内的真实用户编辑使 `marker` 变为 `null` 且不弹错误提示 —— 即"只免疫同步命令事件与无真实来源的框架回声"，未被放宽成"无条件忽略 input"。**R1 通过。**

---

## 2. R2 — 已修复（上一版"未达标"判定作废）

### 2.1 勘误：缺陷在我方探针

上一版用的 `_harness3\fixture.mjs` 第 122 行的插桩包装器：

```js
const __invalid = invalidateDraftTranslation;
globalThis.invalidateDraftTranslation = invalidateDraftTranslation =
  () => { globalThis.__trace.push(['invalidate']); return __invalid(); };   // ← 丢掉了全部实参
```

而 `final/content.js:834-842` 的实现是：

```js
function invalidateDraftTranslation(reason = '') {
  const wasPending = state.isTranslatingDraft;
  ...
  setComposerBusy(false);
  if (reason && wasPending) showComposerNotice(reason);   // reason 为 undefined 时这条被跳过
}
```

包装器把 `reason` 变成 `undefined`，**恰好关掉了 R2 要验证的那条提示**。外层再套 `(...args)` 也救不回来——参数已经在内层丢失。因此上一版"notice 为 null"是探针造成的，不是实现缺陷。

### 2.2 更正后的实测（`_harness3\probe-r2-corrected.mjs`，加载 `fixture-preserved-args.mjs`）

**无任何插桩的干净运行**

```json
"languageSwitch_clean": {
  "isTranslatingBeforeSwitch": true,
  "immediate": { "noticeAttr": "目标语言已改变，已取消旧翻译，请重新翻译",
                 "statusText": "目标语言已改变，已取消旧翻译，请重新翻译", "statusHidden": false },
  "later":     { "notice": "目标语言已改变，已取消旧翻译，请重新翻译",
                 "statusVisible": true, "busyClass": false },
  "draft": "原始草稿",
  "calls": [["en", "原始草稿"]]
}
"settingsPush_clean": {
  "immediate": { "noticeAttr": "设置已改变，已取消旧翻译，请重新翻译",
                 "statusText": "设置已改变，已取消旧翻译，请重新翻译" },
  "later":     { "notice": "设置已改变，已取消旧翻译，请重新翻译", "statusVisible": true, "busyClass": false },
  "draft": "原始草稿",
  "calls": [["en", "原始草稿"]]
}
```

**带追踪（包装器已 `...args` 转发）的调用链**

```json
"tracedChain": {
  "trace": [
    ["invalidate(\"\")"],
    ["invalidate(\"目标语言已改变，已取消旧翻译，请重新翻译\")"],
    ["show", "目标语言已改变，已取消旧翻译，请重新翻译"]
  ],
  "notice": "目标语言已改变，已取消旧翻译，请重新翻译",
  "draft": "原始草稿"
}
```

**对照（无语言/设置变化）**

```json
"control_noChange": { "notice": "已翻译，再按 Enter 发送", "draft": "TRANSLATED", "calls": 1 }
```

结论：显式改目标语言与设置推送两条路径**都**在失效瞬间显示原因文案，且持续可见（`statusVisible: true`）、忙碌类已清除、草稿保持原文。**R2 通过。上一版判定撤销。**

---

## 3. R3 — 已修复（在 `final-addendum` 上验证）

### 3.1 我方探针的两个缺陷（均已排除）

1. **函数替换插桩**：上一版用 `isEquivalentWrittenDraft` / `readComposerText` 的替换包装器取证；本版按要求**完全不做函数替换、不改状态属性**，只用 DOM 与返回值观察。
2. **`innerText` 覆写**：上一版夹具先赋 `textContent` 再赋 `innerText`，而 happy-dom 的 `innerText` 不合成换行，导致测量面上出现"换行消失"的假象。本版改为 **div/br 表达文本、`innerText` 只赋值一次**，并区分事件来源：**框架/应用 input 用 `data:null`，真实用户编辑用 `data:"<文字>"`**。

### 3.2 干净夹具实测（`_harness3\r34-clean.mjs`，无插桩）

```json
"R3_clean": [
  { "case": "a: faithful multi-line write",
    "editorText": "\"Line one\\nLine two\\nLine three\"",
    "notice": "已翻译，再按 Enter 发送", "statusVisible": true,
    "extraCalls": 0, "sends": 1 },

  { "case": "b: truncated write",
    "editorText": "\"Translat\"",
    "notice": "译文未能写入输入框，原文已保留在提示中，请重试", "statusVisible": true,
    "buttons": ["重试翻译", "关闭提示", "恢复原稿"], "hasOriginalTextarea": true },

  { "case": "c: faithful write + data:null echo",
    "editorText": "\"TRANSLATED\"", "notice": "已翻译，再按 Enter 发送",
    "calls": 1, "sends": 1 }
]
```

- **(a) 忠实多行写入**：`readComposerText` 得到带换行的 `"Line one\nLine two\nLine three"`，判定成功、无额外请求、原生发送一次 —— 上一版"多行/换行被判为有损"的担忧**不能复现**，属探针伪影。
- **(b) 截断写入**：可见错误 + `重试翻译`/`关闭提示`/`恢复原稿` + 原文 textarea。
- **(c) `data:null` 框架回声**：不再被误判为用户编辑（这正是 `final-addendum` 新增的 `event.data === ''` 兼容分支所覆盖的形态），仍只有 1 次请求、正常发送。

### 3.3 关于 20.9.0 / 20.14.5 的差异

`final/package-lock.json` 锁定 happy-dom **20.9.0**；我此前的 `_harness2/3` 安装的是 **20.14.5**。在 20.14.5 下 `new InputEvent('input', { data: null })` 的 `event.data` 为**空字符串**而非 `null`，因此旧的 `event.data == null` 判断不成立 —— 与补丁方定位一致。`final-addendum` 增加 `event.data === ''` 后，两种取值都被覆盖，且**真实用户事件（`data` 为实际文字）仍不会被吞**（R4-b 已验证）。

**R3 通过（在 `final-addendum` 上）。**

---

## 4. R4 — 已修复（在 `final-addendum` 上验证）

```json
"R4_clean": {
  "before": {
    "editorText": "\"TRAN\"",
    "notice": "译文未能写入输入框，原文已保留在提示中，请重试",
    "buttons": ["重试翻译", "关闭提示", "恢复原稿"]
  },
  "restorePresent": true,
  "callsAfterRestore": 0,
  "totalCalls": 1,
  "sends": 0,
  "draftAfterRestore": "\"中文原稿\"",
  "noticeAfter": null,
  "failedWriteAfter": null,
  "markerAfter": null
}
```

点击 `恢复原稿` 后：**`draft = 中文原稿`**（原样恢复）、**`calls` 不增加**、**`sends = 0`**、提示关闭、译文标记清空 —— 与补丁方在真实 Chromium 中的验证结果一致（`calls=1, sends=0, draft=中文原稿`）。

**防过度免疫对照（R4-b）**

```json
"R4b_userEditAfterFailure": {
  "draft": "\"用户改成了新的草稿\"", "notice": null,
  "failedWrite": null, "marker": null
}
```

失败后用户真实改为别的草稿 → 提示与备份失效、标记清空，不会被"恢复原稿"覆盖。**R4 通过。**

---

## 5. R6 — 符合声明的取舍（在 `final` 上验证）

```json
"R6_latinSendPath": [
  { "label": "es draft, target en, reliable es", "calls": [["en","Hola, confirma el precio final"]], "sends": 0 },
  { "label": "fr draft, target en, reliable fr", "calls": [["en","Bonjour, confirmez le prix"]],     "sends": 0 },
  { "label": "es draft, target es, reliable es", "calls": [], "sends": 1 },
  { "label": "es draft, target en, unreliable",  "calls": [], "sends": 1 },
  { "label": "en draft, target en, unreliable",  "calls": [], "sends": 1 },
  { "label": "en draft, target en, reliable en", "calls": [], "sends": 1 },
  { "label": "short latin (ok merci), target en, unreliable", "calls": [], "sends": 1 },
  { "label": "zh draft, target en, no detection", "calls": [["en","你好，请确认交期"]], "sends": 0 }
]
```

- 可靠检测的外语（es/fr）→ 目标英语：**翻译**（第二轮 R6 的缺陷已消除）。
- 可靠同目标（es→es、en→en）：**跳过接口**直接发送。
- 英语默认 + 无法可靠检测的短拉丁文本：**保持原文**（明确取舍）。
- 中文草稿（非拉丁）不受影响，正常翻译。

**R6 通过。**

---

## 6. 勘误表（相对上一版 `final-review.md`）

| 上一版结论 | 实际 | 原因 |
|---|---|---|
| **R2 未达标**：reason 已传入但 DOM 无提示 | ❌ **作废** → R2 已修复 | 我方 `_harness3\fixture.mjs:122` 的包装器 `() => __invalid()` **丢弃 `reason`**，`if (reason && wasPending)` 因此不成立，恰好关掉了被验证的提示。修正 `...args` 转发后，改语言与设置推送均**即时且持续**显示文案 |
| **R3 残留**：`newlines dropped` / `truncated` 静默、两次运行不一致 | ❌ **作废** → R3 已修复 | (1) 夹具先赋 `textContent` 再赋 `innerText`，happy-dom 的 `innerText` 不合成换行造成伪影；(2) 探针用了函数替换插桩；(3) 旧快照在 happy-dom 20.14.5 下 `data:null` 实为空字符串。改用干净夹具 + `final-addendum` 后三条场景全部确定通过 |
| **R3 观察**：`<div><br></div>` 多段 DOM 可能多计换行 | ⚪ 不再主张 | 与全局一致：忠实多行写入在干净夹具下判定成功、无额外请求；上一版现象无法在无插桩条件下复现，按伪影处理 |
| **R4 未观测到生效** | ❌ **作废** → R4 已验证生效 | 触发点此前落入 R3 伪影分支；干净夹具下 `恢复原稿` 完美工作 |
| R1 已修复 / R1 边界正确 / R6 符合取舍 | ✅ 维持 | — |

**我方先前提出、且经实测确认不应采用的建议（继续撤回）**：以"内容等价"作为唯一自回声判据、或无条件忽略自有 `input` 事件 —— R1-b 与 R4-b 都证明那会吞掉真实用户编辑。当前"只免疫同步命令事件 + 无真实来源的框架回声（含空字符串回声）"的边界是正确的。

---

## 7. 仍需真实页面确认的范围（未变）

本轮**未**验证，仍属"需登录页面确认"：

1. 真实 WhatsApp Web 编辑器对 `execCommand('insertText')` 的落盘形态（同步/异步、是否归一化换行）。
2. 真实发送按钮 DOM 与本地化标签；以及 R7 未拦截形态（`aria-label="Menu"` 等）在真实页面上是否真的未受保护 —— 我方构造不足以证明。
3. `chrome.i18n.detectLanguage` 在未安装对应语言包时的 `isReliable` 取值（影响 R6 的"英语默认保持原文"边界）。
4. **实测环境差异**：Chrome 实测确认本项目 Chromium 行为与 happy-dom 20.9.0 一致（`data` 为 `null`）；20.14.5 的差异已由 `final-addendum` 兼容。若后续升级 happy-dom，请保留该回归用例。

---

## 8. 执行清单（可复跑）

```powershell
cd "E:\deepseek work\whatsapp-review-20261004\_harness3"
node acceptance.mjs          # R1 / R6（加载 final）
node probe-r2-corrected.mjs  # R2（加载 fixture-preserved-args.mjs → final，包装器已转发 ...args）
node r34-clean.mjs           # R3 / R4（干净夹具，无函数替换，加载 final-addendum）
```

```powershell
cd "E:\deepseek work\whatsapp-review-20261004\final"           ; npm test   # 60 / 32 / 7
cd "E:\deepseek work\whatsapp-review-20261004\final-addendum"  ; npm test   # 60 / 33 / 7
```

---

*报告完（修订版）。R1/R2/R3/R4/R6 全部通过；上一版 R2 与 R3/R4 的负面结论均系我方探针缺陷，已在本表与各节更正。*
