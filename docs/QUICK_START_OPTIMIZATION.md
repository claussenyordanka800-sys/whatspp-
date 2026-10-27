# 快速优化指南

> **实施状态（已落地）：** 下面第 1、3 项已在 `content.js` 实现（轮询降频 + 轮询间隔提取为 `TIMING` 常量；`findInput()` 按 `isConnected` 缓存），并额外实现了跨扫描的文本容器缓存 `state.containerMemo` 与气泡处理签名，使稳态扫描的布局读取从每轮每消息 1 次降为 0。第 2 项经复核**前提有误**——`pendingTranslations` 已在 `finally` 中清理，真正的缺陷是免费引擎缺少请求超时，已用 `fetchWithTimeout()` 修复。以下保留原始记录，便于对照。

## 立即可做的改进（P0 - 1-2 小时）

### 1. 减少轮询频率（最高优先级）

**位置：** `content.js`（`init()` 与 `watchConversationSwitch()`）

```javascript
// ❌ 原实现
state.scanInterval = setInterval(scanPage, 1500);
state.conversationInterval = setInterval(check, 600);

// ✅ 当前实现
state.scanInterval = setInterval(scanPage, TIMING.scanFallback);        // 3000ms
state.conversationInterval = setInterval(check, TIMING.conversationFallback); // 1500ms

// ✅ 进一步方案：改用事件驱动
// 参考 docs/examples/event-driven-scanner.js
```

**效果：** 轮询次数减少约 55%；配合容器缓存，稳态扫描不再触发布局计算。

---

### 2. ~~添加缓存清理（防止内存泄漏）~~ 前提不成立

**复核结论：** `translateMessage()` 的 `finally` 已经删除 `pendingTranslations` 条目，不存在无限增长。

真正的问题是 Google / 微软 / MyMemory / DeepL 的 `fetch` 没有超时，网络挂起时该条目永久 pending。

```javascript
// ✅ 已实施
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒），请重试或切换引擎`);
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  } finally { clearTimeout(timer); }
}
```

---

### 3. 输入框缓存

**位置：** `content.js`（`findInput()`）

```javascript
function findInput() {
  if (state.cachedInput?.isConnected) return state.cachedInput;
  for (const selector of INPUT_SELECTORS) {
    const node = document.querySelector(selector);
    if (node) { state.cachedInput = node; return node; }
  }
  state.cachedInput = null;
  return null;
}
```

`switchConversation()` 会清空缓存，节点被移除时 `isConnected` 自动失效。
**效果：** 稳态下每次 `findInput()` 只做一次 `isConnected` 判断

---

## 近期改进（P1 - 半天）

### 4. 提取魔法数字为常量（部分已实施）

**位置：** `content.js` 开头

```javascript
// ✅ 已实施：定时器延迟集中到 TIMING
const TIMING = {
  scanFallback: 3000,
  conversationFallback: 1500,
  scanDebounce: 250,
  languageDetect: 350,
  draftTranslate: 900
};
```

`MAX_CONCURRENT_BUBBLE_TRANSLATIONS` 等其余常量保持不变（原本已是具名常量，不需要再包一层 CONFIG）。

---

### 5. 添加 JSDoc 类型注释

**位置：** 所有导出函数

```javascript
/**
 * 翻译消息气泡
 * @param {HTMLElement} messageNode - 消息容器节点
 * @param {HTMLElement} textContainer - 文本容器节点
 * @param {boolean} forceRefresh - 是否强制刷新
 * @returns {Promise<void>}
 */
async function translateBubble(messageNode, textContainer, forceRefresh) {
  // ...
}
```

**效果：** IDE 自动完成和类型检查

---

### 6. 输入验证

**位置：** `popup.js` 表单提交处理

```javascript
function validateProviderConfig(provider, config) {
  const errors = [];
  
  // 验证 URL 格式
  if (config.baseUrl) {
    try {
      new URL(config.baseUrl);
    } catch {
      errors.push('接口地址格式无效');
    }
  }
  
  // 验证模型名称（防止注入）
  if (config.model && !/^[a-zA-Z0-9._-]+$/.test(config.model)) {
    errors.push('模型名称包含非法字符');
  }
  
  // 验证 API Key 长度
  if (config.apiKey && config.apiKey.length < 10) {
    errors.push('API Key 格式无效');
  }
  
  return { valid: errors.length === 0, errors };
}

// 在保存配置前调用
const validation = validateProviderConfig(provider, config);
if (!validation.valid) {
  alert('配置验证失败:\n' + validation.errors.join('\n'));
  return;
}
```

**效果：** 防止配置错误和潜在的安全问题

---

## 长期优化（P2 - 1-2 天）

### 7. 事件驱动扫描（完整实现）

参考 `docs/examples/event-driven-scanner.js`

**步骤：**
1. 安装 MutationObserver 替代 `scanInterval`
2. 使用 URL 事件监听替代 `conversationInterval` 轮询
3. 测试所有场景（新消息、会话切换、滚动）

**效果：** 减少 90% CPU 占用

---

### 8. 模块化拆分

**建议结构：**
```
src/
├── background/
│   ├── index.js           # 入口
│   ├── translation.js     # 翻译核心
│   ├── providers.js       # 引擎适配
│   └── cache.js           # 缓存管理
├── content/
│   ├── index.js           # 入口
│   ├── scanner.js         # 页面扫描
│   ├── composer.js        # 输入框处理
│   └── bubbles.js         # 气泡翻译
├── shared/
│   ├── constants.js       # 常量
│   ├── utils.js           # 工具函数
│   └── config.js          # 配置管理
└── ui/
    ├── popup.js           # 弹窗
    └── panels.js          # 面板
```

**步骤：**
1. 创建目录结构
2. 逐步迁移代码（一个模块一个模块）
3. 使用 ES6 模块 import/export
4. 更新 manifest.json

---

### 9. 增加单元测试

**位置：** `tests/` 目录

```javascript
// tests/unit/utils.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeText, hasTranslatableText } from '../../shared/utils.js';

describe('Text normalization', () => {
  it('should remove extra whitespace', () => {
    assert.strictEqual(
      normalizeText('  hello   world  '),
      'hello world'
    );
  });

  it('should remove emojis', () => {
    assert.strictEqual(
      normalizeText('hello 👋 world 🌍'),
      'hello world'
    );
  });
});

describe('Translation detection', () => {
  it('should skip pure numbers', () => {
    assert.strictEqual(hasTranslatableText('12345'), false);
  });

  it('should translate sentences', () => {
    assert.strictEqual(hasTranslatableText('Hello world'), true);
  });

  it('should skip pure emojis', () => {
    assert.strictEqual(hasTranslatableText('👋🌍🎉'), false);
  });
});
```

**运行：**
```bash
npm test
```

---

## 优化检查清单

### 性能
- [ ] 减少轮询频率（或改用事件驱动）
- [ ] 添加缓存清理机制
- [ ] 优化 DOM 查询（缓存常用元素）
- [ ] 减少重复计算

### 代码质量
- [ ] 提取魔法数字为常量
- [ ] 拆分长函数（> 50 行）
- [ ] 添加 JSDoc 注释
- [ ] 统一错误处理

### 安全性
- [ ] 添加输入验证
- [ ] 避免敏感信息泄漏
- [ ] 防止 XSS 注入
- [ ] 使用 CSP

### 可维护性
- [ ] 模块化拆分
- [ ] 增加单元测试
- [ ] 编写文档
- [ ] 代码审查

---

## 测试指南

### 手动测试清单

**基础功能：**
- [ ] 新消息自动翻译
- [ ] 输入框草稿翻译
- [ ] 手动翻译按钮
- [ ] 撤销翻译

**性能测试：**
- [ ] 打开 Chrome DevTools Performance
- [ ] 录制 30 秒（包括收发消息）
- [ ] 检查 CPU 占用 < 5%
- [ ] 检查内存增长 < 10MB

**兼容性测试：**
- [ ] Chrome 最新版
- [ ] Edge 最新版
- [ ] 不同屏幕尺寸
- [ ] 暗色/亮色主题

**压力测试：**
- [ ] 快速收到 10 条消息
- [ ] 切换 5 个会话
- [ ] 运行 1 小时
- [ ] 检查内存泄漏

---

## 工具推荐

### 性能分析
- Chrome DevTools Performance
- Memory Profiler
- Lighthouse

### 代码质量
- ESLint
- Prettier
- TypeScript (渐进式迁移)

### 测试
- Node.js Test Runner
- Playwright (E2E)
- Jest (如果需要更多功能)

---

## 获取帮助

如果遇到问题：

1. 查看详细文档：`docs/OPTIMIZATION_SUGGESTIONS.md`
2. 查看代码示例：`docs/examples/`
3. 查看现有测试：`tests/`
4. 提交 Issue

---

## 版本建议

建议按以下顺序发布版本：

**v0.4.0 - 性能优化**
- 减少轮询
- 缓存清理
- DOM 查询优化

**v0.5.0 - 代码质量**
- 魔法数字常量化
- 函数拆分
- JSDoc 注释

**v1.0.0 - 架构升级**
- 模块化
- 完整测试覆盖
- 事件驱动架构

每个版本发布后，充分测试再进入下一个版本。
