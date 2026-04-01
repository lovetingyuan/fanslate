# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个基于 **WXT Framework** 开发的浏览器翻译插件,提供中英文双向翻译功能。用户通过右键菜单选择文本进行翻译,插件使用 Shadow DOM 在页面中展示翻译结果。

**技术栈**: WXT + React 19 + TypeScript (Strict) + Tailwind CSS + DaisyUI

## 开发命令

```bash
# 开发模式 (支持 HMR)
npm run dev              # Chrome/Edge
npm run dev:firefox      # Firefox

# 构建生产版本
npm run build            # Chrome/Edge
npm run build:firefox    # Firefox

# 打包为 zip
npm run zip              # Chrome/Edge
npm run zip:firefox      # Firefox

# 类型检查
npm run compile          # TypeScript 类型检查 (不生成文件)

# 代码检查和格式化
npm run lint             # 使用 oxlint 检查并自动修复,然后用 oxfmt 格式化
```

## 核心架构

### 消息传递机制

插件使用 **三层消息传递架构**:

1. **Background Script** (`entrypoints/background.ts`):
   - 管理右键菜单和翻译请求
   - 维护每个标签页的翻译状态缓存 (`tabSelections` Map)
   - 管理每个服务的 AbortController 以支持取消请求
   - 实现增量翻译:多个服务并行请求,结果逐个返回并缓存

2. **Content Script** (`entrypoints/content.ts`):
   - 监听页面文本选择事件
   - 接收 background 消息并控制 TranslationDialog 显示
   - 使用 Shadow DOM 隔离样式

3. **Popup** (`entrypoints/popup/`):
   - 扩展设置界面
   - 管理翻译服务选择和 API 密钥配置

### 翻译服务架构 (`utils/translation.ts`)

- **多服务支持**: Google, Microsoft, Tencent, OpenRouter
- **服务抽象**: 每个服务实现 `TranslatorFunction` 接口
- **状态管理**:
  - `selectedServices`: 用户选择的翻译服务列表(支持多选)
  - `hiddenServices`: 隐藏的服务(默认隐藏腾讯翻译)
  - 自动迁移旧版单选配置到新版多选
- **缓存机制**: Microsoft token 缓存在内存和 storage 中,避免频繁请求
- **方向检测**: `detectDirection()` 根据中英文字符比例自动判断翻译方向

### 关键数据流

```
用户选择文本 → Content Script 更新菜单标题
→ 用户点击右键菜单 → Background Script 检查缓存
→ 并行请求多个翻译服务 → 逐个返回结果并缓存
→ 发送消息到 Content Script → TranslationDialog 显示结果
```

## TypeScript 规范

- **严格模式**: 禁止使用 `any`,所有类型必须明确定义
- **类型定义位置**:
  - 翻译相关类型在 `utils/translation.ts` 中定义
  - 消息类型在各自的 entrypoint 文件中定义(如 `RuntimeMessageShape`)
- **类型守卫**: 使用 `isTranslationServiceId()` 等函数进行运行时类型检查
- **泛型使用**: 在 `normalizeServiceIds()` 等工具函数中使用泛型保持类型安全

## 样式隔离

- **Shadow DOM**: TranslationDialog 使用 Shadow DOM 封装,防止宿主页面样式污染
- **Tailwind + DaisyUI**: 优先使用 utility classes,避免自定义 CSS
- **DaisyUI 组件**: 使用 `btn`, `card`, `modal` 等预设类保持 UI 一致性

## 状态管理模式

### Background Script 状态

- `tabSelections`: 每个标签页的翻译会话状态
  - `text`: 原文
  - `direction`: 翻译方向
  - `selectedServices`: 当前会话选择的服务
  - `cachedResultsByService`: 按服务缓存的翻译结果
  - `pendingServices`: 正在请求的服务列表
- `tabControllers`: 每个标签页每个服务的 AbortController
- `tabPendingPromises`: 正在进行的翻译 Promise,用于去重请求

### 缓存策略

- **会话级缓存**: 同一文本在同一标签页中只请求一次
- **服务级缓存**: 每个服务的结果独立缓存,支持增量加载
- **强制刷新**: `forceRefresh` 参数可清除指定服务的缓存
- **标签页隔离**: 不同标签页的翻译状态完全独立

## 错误处理

- **网络请求**: 所有翻译函数使用 try-catch 包裹,返回 `TranslationResultItem` 包含 `status` 和 `error`
- **取消请求**: 使用 `isAbortError()` 统一检测 AbortError,避免将取消操作当作错误处理
- **用户反馈**: UI 层必须显示错误状态,不能静默失败

## WXT 特定配置

- **Manifest 配置**: 在 `wxt.config.ts` 中定义,包括权限、CSP 等
- **环境变量**:
  - `WXT_GOOGLE_HTML_API_KEY`: Google 翻译 API 密钥
  - `WXT_OPENROUTER_API_KEY`: OpenRouter API 密钥
  - `WXT_OPENROUTER_MODEL`: OpenRouter 模型 ID
- **HMR 配置**: Vite HMR 端口为 3000

## 临时文件规范

- **严禁在项目中生成临时文件和调试用的文件**（如 `test.ts`、`debug.js`、`temp.txt`、`scratch.*` 等）
- 如果确实需要生成临时文件,**必须统一存放到项目根目录的 `temp/` 文件夹中**
- `temp/` 文件夹已加入 `.gitignore`,不会被提交到版本控制
- 临时文件使用完毕后应及时清理

## 注释规范

- **必须注释的场景**:
  - 复杂的消息传递逻辑
  - 缓存和状态管理策略
  - 类型定义和接口(使用 JSDoc)
  - 非显而易见的业务逻辑
- **注释风格**: 解释"为什么"而不是"做什么"

## 代码风格

- **React**: 仅使用 Functional Components + Hooks
- **异步处理**: 使用 `async/await`,避免 Promise 链
- **命名约定**:
  - 组件: PascalCase
  - 函数/变量: camelCase
  - 常量: UPPER_SNAKE_CASE
  - 类型/接口: PascalCase

## 常见任务

### 添加新的翻译服务

1. 在 `TRANSLATION_SERVICE_IDS` 中添加服务 ID
2. 在 `TRANSLATION_SERVICE_OPTIONS` 和 `TRANSLATION_SERVICE_LABELS` 中添加配置
3. 实现 `TranslatorFunction` 并添加到 `translatorMap`
4. 确保返回格式符合 API 响应类型定义

### 修改消息传递

1. 在 `RuntimeMessageShape` 中定义新的消息字段
2. 在 `background.ts` 的 `onMessage` 监听器中处理
3. 在 `content.ts` 中发送或接收消息
4. 确保类型安全,使用类型守卫验证运行时数据

### 调试技巧

- 开发模式下,console.log 会输出到浏览器控制台
- Background Script 日志在扩展的 Service Worker 控制台
- Content Script 日志在页面控制台
- 使用 `logger.log()` 统一日志输出(生产环境自动禁用)
