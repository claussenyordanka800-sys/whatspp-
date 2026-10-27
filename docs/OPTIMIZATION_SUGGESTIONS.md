# WhatsApp 翻译插件优化建议

## 1. 性能优化

### 1.1 减少轮询，改用事件驱动
**问题：** 
- `content.js` 使用 `setInterval(scanPage, 1500)` 每 1.5 秒扫描整个页面
- `watchConversationSwitch()` 使用 `setInterval(check, 600)` 每 600ms 检查会话切换

**建议：**
```javascript
// 改用 MutationObserver 监听特定区域
function installSmartObserver() {
  const mainPanel = document.querySelector('#main');
  if (!mainPanel) return;
  
  state.observer = new MutationObserver((mutations) => {
    const hasRelevantChanges = mutations.some(m => 
      m.type === 'childList' && 
      (m.target.matches(MESSAGE_SELECTOR) || m.addedNodes.length)
    );
    if (hasRelevantChanges) scheduleScan();
  });
  
  state.observer.observe(mainPanel, {
    childList: true,
    subtree: true,
    attributes: false // 不监听属性变化
  });
}
```

### 1.2 防抖和节流
**问题：** `scheduleScan()` 频繁调用可能导致性能问题

**建议：**
```javascript
// 使用更长的防抖延迟
function scheduleScan() {
  clearTimeout(state.scanTimer);
  // 从 250ms 增加到 500ms，减少不必要的扫描
  state.scanTimer = setTimeout(scanPage, 500);
}
```

### 1.3 DOM 查询优化
**问题：** `findInput()` 每次都遍历多个选择器

**建议：**
```javascript
// 缓存 input 引用
function findInput(useCache = true) {
  if (useCache && state.cachedInput?.isConnected) {
    return state.cachedInput;
  }
  
  for (const selector of INPUT_SELECTORS) {
    const node = document.querySelector(selector);
    if (node) {
      state.cachedInput = node;
      return node;
    }
  }
  state.cachedInput = null;
  return null;
}

// 会话切换时清除缓存
function switchConversation(conversationId) {
  // ... existing code ...
  state.cachedInput = null;
}
```

### 1.4 翻译请求去重优化
**建议：** 当前的 `pendingTranslations` Map 很好，但可以增加超时清理：
```javascript
// background.js
const PENDING_REQUEST_TIMEOUT = 30000; // 30 seconds

function cleanupStaleRequests() {
  const now = Date.now();
  for (const [key, promise] of pendingTranslations.entries()) {
    if (promise.timestamp && now - promise.timestamp > PENDING_REQUEST_TIMEOUT) {
      pendingTranslations.delete(key);
    }
  }
}

// 定期清理
setInterval(cleanupStaleRequests, 60000);
```

## 2. 代码质量改进

### 2.1 魔法数字提取为常量
**问题：** 代码中硬编码了很多数字

**建议：**
```javascript
// content.js 开头添加
const CONFIG = {
  SCAN_INTERVAL: 1500,
  CONVERSATION_CHECK_INTERVAL: 600,
  SCAN_DEBOUNCE: 500,
  DRAFT_TRANSLATION_DELAY: 900,
  DETECT_LANGUAGE_DELAY: 350,
  NOTICE_AUTO_DISMISS: 2300,
  MAX_PHRASES: 100,
  MAX_PHRASE_LENGTH: 2000,
  COMPOSER_WRITE_TIMEOUT: 500,
  MAX_CONCURRENT_BUBBLES: 3,
  BUBBLE_RESULT_CACHE_SIZE: 300
};
```

### 2.2 函数复杂度降低
**问题：** `translateComposer()` 函数过长（144 行），难以维护

**建议：** 拆分为更小的函数
```javascript
// 拆分逻辑
async function prepareTranslation(input, displayedText) {
  // 提取准备逻辑
}

async function executeTranslation(text, targetLanguage) {
  // 提取翻译执行逻辑
}

async function applyTranslation(input, translatedText) {
  // 提取应用逻辑
}

async function translateComposer(showNotice, sendAfter, sendIfAlreadyTarget) {
  // 主函数变得简洁
  const preparation = await prepareTranslation(input, displayedText);
  const result = await executeTranslation(preparation.text, preparation.targetLanguage);
  await applyTranslation(input, result.text);
}
```

### 2.3 类型安全改进
**建议：** 添加 JSDoc 注释增强类型提示
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

## 3. 错误处理增强

### 3.1 统一错误处理
**建议：** 创建错误处理中心
```javascript
// utils/errors.js
class TranslationError extends Error {
  constructor(message, provider, status, context = {}) {
    super(message);
    this.name = 'TranslationError';
    this.provider = provider;
    this.status = status;
    this.context = context;
  }
}

function handleTranslationError(error, context) {
  // 统一错误处理
  if (error instanceof TranslationError) {
    // 记录到诊断日志
    reportDiag({
      level: 'error',
      event: `translate.${error.provider}`,
      message: error.message,
      status: error.status,
      ...error.context
    });
  }
  
  // 格式化用户友好的错误消息
  return formatTranslationError(error);
}
```

### 3.2 重试机制优化
**问题：** Google RPC 的重试逻辑过于复杂

**建议：**
```javascript
// 通用重试函数
async function retryWithBackoff(fn, maxAttempts = 3, baseDelay = 500) {
  let lastError;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      
      // 不应重试的错误
      if (error.status && ![429, 500, 502, 503].includes(error.status)) {
        throw error;
      }
      
      if (attempt < maxAttempts - 1) {
        await waitForRetry(baseDelay * Math.pow(2, attempt));
      }
    }
  }
  
  throw lastError;
}
```

## 4. 安全性增强

### 4.1 内容安全策略
**建议：** manifest.json 中明确 CSP
```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

### 4.2 敏感信息保护加强
**建议：** 增加运行时脱敏检查
```javascript
// 在发送请求前验证
function sanitizeRequestData(data) {
  const sanitized = { ...data };
  
  // 确保不发送完整 API Key
  if (sanitized.apiKey) {
    console.warn('API Key should not be sent in request data');
    delete sanitized.apiKey;
  }
  
  return sanitized;
}
```

### 4.3 输入验证
**建议：** 加强用户输入验证
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
  
  return { valid: errors.length === 0, errors };
}
```

## 5. 可维护性改进

### 5.1 模块化拆分
**建议：** 将大文件拆分为模块
```
src/
├── background/
│   ├── translation.js    // 翻译核心逻辑
│   ├── providers.js      // 引擎适配器
│   └── cache.js          // 缓存管理
├── content/
│   ├── scanner.js        // 页面扫描
│   ├── composer.js       // 输入框处理
│   └── bubbles.js        // 气泡翻译
├── shared/
│   ├── constants.js
│   └── utils.js
└── ui/
    ├── popup.js
    └── panels.js
```

### 5.2 配置管理集中化
**建议：** 创建配置管理器
```javascript
// config/manager.js
class ConfigManager {
  constructor() {
    this.cache = null;
    this.listeners = [];
  }
  
  async get(key) {
    if (!this.cache) {
      await this.refresh();
    }
    return key ? this.cache[key] : this.cache;
  }
  
  async set(updates) {
    const current = await this.get();
    const merged = { ...current, ...updates };
    await chrome.storage.sync.set({ settings: merged });
    this.cache = merged;
    this.notify(updates);
  }
  
  onChange(callback) {
    this.listeners.push(callback);
  }
  
  notify(changes) {
    this.listeners.forEach(fn => fn(changes));
  }
}
```

### 5.3 测试覆盖增强
**建议：** 增加单元测试
```javascript
// tests/unit/translation.test.mjs
import { describe, it, assert } from 'node:test';
import { normalizeText, hasTranslatableText } from '../shared/utils.js';

describe('Text normalization', () => {
  it('should remove extra whitespace', () => {
    assert.strictEqual(
      normalizeText('  hello   world  '),
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
});
```

## 6. 用户体验优化

### 6.1 离线处理
**建议：** 增加离线检测和缓存优先
```javascript
// 检测网络状态
function isOnline() {
  return navigator.onLine;
}

async function translateWithOfflineSupport(text, targetLanguage) {
  // 优先使用缓存
  const cached = await getCachedTranslation(text, targetLanguage);
  if (cached) {
    return { ...cached, fromCache: true };
  }
  
  if (!isOnline()) {
    throw new Error('网络离线，暂时无法翻译新内容');
  }
  
  // 在线翻译
  return await translateOnline(text, targetLanguage);
}
```

### 6.2 加载状态改进
**建议：** 更好的加载指示器
```javascript
function showTranslationProgress(message, percentage = null) {
  const status = getComposerStatus();
  const text = percentage !== null 
    ? `${message} (${Math.round(percentage)}%)`
    : message;
  status.querySelector('span').textContent = text;
}

// 使用示例
async function translateWithProgress(text) {
  showTranslationProgress('准备翻译', 10);
  const prepared = await prepareText(text);
  
  showTranslationProgress('正在翻译', 50);
  const result = await callAPI(prepared);
  
  showTranslationProgress('处理结果', 90);
  return processResult(result);
}
```

### 6.3 可访问性改进
**建议：** 增强 ARIA 标签
```javascript
function insertTranslation(textContainer, translatedText, isError = false) {
  const output = document.createElement("span");
  output.className = `wa-bubble-translator-output${isError ? " wa-bubble-translator-error" : ""}`;
  output.textContent = translatedText;
  
  // 增强可访问性
  output.setAttribute('role', isError ? 'alert' : 'status');
  output.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  output.setAttribute('aria-label', isError ? '翻译失败' : '翻译结果');
  
  if (isError) {
    output.setAttribute('aria-describedby', 'translation-error-help');
    output.tabIndex = 0; // 可聚焦
  }
  
  textContainer.appendChild(output);
}
```

## 7. 监控和分析

### 7.1 性能监控
**建议：** 添加性能指标收集
```javascript
// 性能跟踪
const performanceTracker = {
  metrics: new Map(),
  
  start(operation) {
    this.metrics.set(operation, performance.now());
  },
  
  end(operation) {
    const start = this.metrics.get(operation);
    if (start) {
      const duration = performance.now() - start;
      this.metrics.delete(operation);
      
      // 记录慢操作
      if (duration > 1000) {
        reportDiag({
          level: 'warn',
          event: 'performance.slow_operation',
          operation,
          duration: Math.round(duration)
        });
      }
      
      return duration;
    }
  }
};

// 使用示例
async function translateWithTracking(text) {
  performanceTracker.start('translation');
  try {
    return await translate(text);
  } finally {
    performanceTracker.end('translation');
  }
}
```

### 7.2 用户行为分析（可选）
**建议：** 记录匿名使用统计
```javascript
function trackUsage(event, metadata = {}) {
  // 仅记录匿名的功能使用情况
  reportDiag({
    level: 'info',
    event: `usage.${event}`,
    ...metadata
  });
}

// 示例
trackUsage('translation_success', { provider: 'google', cached: false });
trackUsage('ai_assist_used', { action: 'reply' });
```

## 总结

优先级排序：

**P0 - 立即修复：**
1. 减少轮询频率（性能影响大）
2. 添加超时清理机制（防止内存泄漏）
3. 输入验证增强（安全性）

**P1 - 近期改进：**
1. 函数复杂度降低
2. 错误处理统一
3. DOM 查询优化

**P2 - 长期优化：**
1. 模块化拆分
2. 测试覆盖增强
3. 性能监控

建议逐步实施，每次改动后进行充分测试。
