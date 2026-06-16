# 找工作神器 Job Hunter

一个帮你找工作的浏览器插件。

打开英文招聘页面（LinkedIn、公司官网的 JD 等），一键**网页双语翻译**——原文下方紧跟中文译文，绿色高亮、清晰好读。在此基础上，逐步加入面向求职者的 AI 功能（职位要求提取、简历匹配、行业黑话解释等）。

## 当前功能
- 🟢 **整页双语翻译**：英文原文 + 中文译文对照，支持 LinkedIn 等动态网页
- 🤖 **自带 LLM 翻译**：可接入 DeepSeek 等多家模型，用自己的 API Key

## 规划中（找工作助手方向）
- 📋 一键分析 JD：提取核心硬要求、标出红旗与亮点
- 📊 简历匹配度打分
- 💬 划词解释外企术语 / 行业黑话

## 本地开发
```bash
pnpm install
pnpm dev          # 开发模式（热重载）
pnpm build        # 构建生产版本到 .output/chrome-mv3
```
> Windows 上若 `pnpm install` 的 postinstall 步骤报错，单独运行：
> `$env:WXT_SKIP_ENV_VALIDATION="true"; pnpm exec wxt prepare`

构建后在浏览器 `edge://extensions` 或 `chrome://extensions` 打开开发者模式，「加载解压缩的扩展」选择 `.output/chrome-mv3` 文件夹即可。

## 致谢与许可

本项目基于优秀的开源项目 **[Read Frog（陪读蛙）](https://github.com/mengxi-ream/read-frog)** 改造而来，翻译引擎、动态网页处理等核心能力归功于原项目及其贡献者。原始说明见 [README.read-frog.md](./README.read-frog.md)。

遵循 **GPL-3.0** 许可证（与上游一致），详见 [LICENSE](./LICENSE)。
