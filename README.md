# fanslate

![Vibe Coding](https://img.shields.io/badge/vibe-coding-blueviolet)

A lightweight browser extension for bidirectional Chinese-English translation.

fanslate 让你在浏览网页时更快完成中英互译。选中文本后右键即可翻译，也可以在插件面板中直接输入内容进行翻译。

## Features

- 选中文本后右键翻译，减少复制粘贴步骤。
- 自动识别中英文方向，直接翻译到另一种语言。
- 支持网页划词翻译和自由输入翻译两种使用方式。
- 支持多种翻译服务来源，可根据偏好选择结果。
- 界面简洁，翻译结果展示轻量，不打断阅读流程。

## Download

Chrome Web Store:

[中英直译 - Chrome Web Store](https://chromewebstore.google.com/detail/%E4%B8%AD%E8%8B%B1%E7%9B%B4%E8%AF%91/hlffbcdnfonoffblnlcdcglajgoknklf)

## Translation Smoke Tests

真实接口 smoke test 会固定校验每个翻译服务是否能把 `apple` 翻译成 `苹果`。

运行前需要在环境变量中提供测试所需的 key：

- `GOOGLE_TRANSLATE_API_KEY`
- `DEEPL_API_KEY`
- `OPENROUTER_API_KEY`

OpenRouter 的 smoke test 固定使用 `openrouter/free` 模型。

可单独运行：

```bash
npm test
```

`npm run zip` 和 `npm run zip:firefox` 现在都会先执行这组 smoke test，只有测试通过后才会继续打包。

## 📄 License

[MIT License](LICENSE)
