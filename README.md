<p align="center">
  <img src="src/assets/logo/superting-logo-smark.svg" alt="SuperTing" width="160" />
</p>

<h1 align="center">超级听记 / SuperTing</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat" alt="License" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat" alt="Platform" />
  <img src="https://img.shields.io/badge/privacy--first-local%20first-blue?style=flat" alt="Privacy first" />
</p>

<p align="center">
  <strong>飞书妙记 / 钉钉听记 的开源替代 + 你的超级个人助手</strong><br/>
  隐私优先、本地运行的语音转文字 · 会议记录 · 个人知识库 · AI Agent 数据中心
</p>

<p align="center">
  <a href="README.en.md">English README</a>
</p>

---

## 项目定位

**SuperTing 想要做两件事：**

1. **替代飞书妙记 / 钉钉听记这一类云端会议记录工具** —— 同样丝滑的会议录制、说话人区分、自动纪要，但**完全跑在你自己的电脑上**，音频和转录文本不经过任何云端服务。可以离线使用。
2. **成为一个真正能用的"超级个人助手"** —— 会议、访谈、灵感、读书、课程、方案讨论、周报素材……所有日常输入都沉淀成可检索、可总结、可被 AI 调用的本地知识库，再通过 MCP 协议让 Codex、Claude 等 agent 调取这些上下文，替你完成周报、方案、纪要、复盘、问答。

相比同类产品，SuperTing 的核心差异点是：

- **完全开源、跨平台**（macOS / Windows / Linux）
- **本地优先**：转录、嵌入、向量检索都可以在本地完成
- **支持国内模型生态**：DeepSeek、通义千问、智谱、月之暗面等可作为推理/清洗后端
- **个人数据底座**：你说话、思考、记录的每一件事都进了你自己的 SQLite + 向量索引，永远属于你
- **Agent 友好**：通过本地 MCP server 把知识库开放给任何 agent

```text
                    本地超级助理（SuperTing知识库+本地Agent）

┌──────────────────────────────────────────────────────────────┐
│                         个人日常输入                          │
├───────────────┬───────────────┬───────────────┬──────────────┤
│ 会议 / 访谈    │ 语音灵感       │ 课程 / 学习    │ 工作讨论      │
│ 音频文件       │ 随手记录       │ 读书笔记       │ 项目资料      │
└───────┬───────┴───────┬───────┴───────┬───────┴──────┬───────┘
        │               │               │              │
        v               v               v              v
┌──────────────────────────────────────────────────────────────┐
│                    SuperTing Data Center                    │
│                                                              │
│  本地录音  →  转录文本  →  笔记整理  →  增强内容  →  语义索引 │
│                                                              │
│  原始音频       Transcript       Notes        AI Summary     │
└───────────────┬───────────────────────┬──────────────────────┘
                │                       │
                v                       v
┌──────────────────────────────┐  ┌────────────────────────────┐
│        本地隐私优先           │  │        国内模型生态          │
│  本地存储 / 本地模型 / 可控清理 │  │ DeepSeek / 通义 / 智谱 / Kimi │
└───────────────┬──────────────┘  └──────────────┬─────────────┘
                │                                │
                └───────────────┬────────────────┘
                                v
┌──────────────────────────────────────────────────────────────┐
│                       MCP / Skill Bridge                     │
│                                                              │
│        Codex        Claude        Local Agent        Others   │
└───────────────┬───────────────┬───────────────┬──────────────┘
                │               │               │
                v               v               v
┌──────────────────────────────────────────────────────────────┐
│                         自动化输出                            │
├───────────────┬───────────────┬───────────────┬──────────────┤
│ 写周报         │ 做方案         │ 写文章         │ 项目复盘      │
│ 会议纪要       │ 知识问答       │ 上下文检索     │ 行动项追踪    │
└───────────────┴───────────────┴───────────────┴──────────────┘
```

## 本分支追加能力

本分支围绕"听写可靠、笔记可工作化、AI 嵌入式可用、工程化与本地化收口"四个维度持续建设，目标是将 SuperTing 打造成适合中文用户长期沉淀个人知识资产的桌面语音与笔记工作台。

- ✅ **听写结果归一化与链路治理**：构建听写全链路的稳定基座，覆盖实时短听写、笔记编辑流、上传音频转录与会议录制等场景；统一转录 → 清理/重排 → 词典纠错顺序，支持失败兜底，确保任何一环异常都不影响最终输出可用。
- ✅ **词典强纠错**：在 ASR 之后引入确定性词典纠错层，对已知词做大小写归一化与保守近音纠错；新增"常见误识别"别名表（如 `Antibus → EntVerse`），允许为稳定错误配置强制替换，并持久化到 SQLite，覆盖短听写、历史重转录与上传转录全链路。
- ✅ **笔记编辑器化**：把笔记从纯文本容器升级为可用工作面，支持多原始音频关联与回填、原始音频下载、转录与内容双向落库、基于内容指纹的"增强内容"判定，避免覆盖用户已修改的标题。
- ✅ **多模态导入与结构化导出**：补齐上传音频转录调度与状态管理、任务状态在页面切换时不丢失；听写配置按"普通听写 / 上传文件转录 / 会议录制"分别生效，避免互相污染。
- ✅ **笔记内嵌 AI 能力**：把"生成笔记 / 总结会议 / 增强内容"打通到统一管线，修复"增强内容"对长转录的误判；自定义 LLM API 兼容与自定义聊天 provider 工具调用能力，扩展可接入模型服务范围。
- ✅ **音频生命周期管理**：厘清会议录制的音频保留与追踪逻辑，提供原始音频下载与多音频关联能力，确保任何阶段都可根据需要回溯原始素材。
- ✅ **LLM 与智能体兼容扩展**：自定义 LLM API 兼容接入、自定义聊天 provider 支持 agent tools，为后续 MCP / agent 体系铺路。
- ✅ **桌面 UI 与本地化**：对齐听写命令菜单、自定义工具聊天处理，修复无效片段与噪声内容进入最终结果；新增中文（zh-CN / zh-TW）等多语种覆盖，关键能力描述随功能同步更新。
- ✅ **打包可靠性**：修复 macOS / Windows 原生依赖的编译路径问题，确保本地构建产物与发行包一致。
- ✅ **工程治理与文档体系**：本地提交整理为 rebase 线性模式，补齐 DCO `Signed-off-by`；README 与 AGENTS.md 持续反映本分支的能力差异和工程约束。

### 待实现

**以下功能已完成基础实现，正在持续优化：**

- ✅ **多发言人识别准确率优化**（speaker diarization 已实现，持续优化识别精度）
- ✅ **UI 及交互性能持续改进**（多轮优化，持续迭代）
- ✅ **接入国内模型生态**（DeepSeek、通义、智谱、月之暗面等已支持）
- ✅ **MCP 对接本地 agent**（本地 MCP server 已实现，支持 Codex / Claude Desktop / Cursor）
- ✅ **Agent 查询个人数据中心**（`search_notes` 工具已实现，Qdrant + FTS5 双路召回）
- ✅ **个人工作流自动总结能力**（周报、方案、文章、项目复盘、会议纪要已支持）
- ✅ **个人知识库检索和问答**（本地向量索引 + 关键字搜索 + RRF 融合）
- ✅ **Skill 机制封装常用工作流**（`agent-skills/` 目录，已实现两个 skill：`openwhispr-api` + `openwhispr-cli`）
- ✅ **对接本地 Codex、Claude 等 agent 系统**（本地 MCP server + LLM provider roster）

**未来探索方向：**

- 探索本地语音唤醒能力（wake word detection）
- 支持 streaming transcription（实时边说边转）
- 增强 agent 自主决策能力，让 agent 能主动建议工作流
- 探索本地 LLM（GGUF 格式）推理能力

## 项目简介

SuperTing 可以把桌面上的语音输入变成文本、笔记和行动项。你可以通过全局快捷键在任意应用中听写，也可以录制会议、上传音频文件转录、整理笔记，并使用 AI 对内容进行清洗、总结和增强。

核心目标是：在保留开源、跨平台、隐私优先特性的基础上，把语音记录变成可以长期积累和复用的个人知识资产。

## 下载与运行

当前代码基于 OpenWhispr 独立维护，支持 macOS、Windows 和 Linux。本分支主要在 macOS Apple Silicon 环境下开发和验证。

| 平台                | 说明                         |
| ------------------- | ---------------------------- |
| macOS Apple Silicon | 本分支主要验证环境           |
| macOS Intel         | 理论支持，需自行验证         |
| Windows             | 上游支持，分支改动需额外验证 |
| Linux               | 上游支持，分支改动需额外验证 |

## 截图

<table>
  <tr>
    <td><img src="docs/screenshots/01-dictation-recording.png" alt="全局语音听写：录音中" /></td>
    <td><img src="docs/screenshots/02-upload-trans.png" alt="上传音频文件转录" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/03-settings-models.png" alt="设置：本地与云端模型管理" /></td>
    <td><img src="docs/screenshots/04-integrations-mcp.png" alt="Integrations：本地 MCP 服务" /></td>
  </tr>
</table>

## 核心能力

围绕"听写 · 会议 · 笔记 · Agent"四大支柱构建。

### 1. 全局语音听写

- 全局快捷键在任意应用光标位置听写（macOS Globe / Fn 按键、Windows / Linux 自定义）
- 推按即录 / 按键释放即停两种模式
- 自动落库到本地 SQLite 历史记录
- 词典强纠错：人名、品牌、技术词、专有名词支持大小写归一化与近音纠错

### 2. 会议录制与转录

- 系统级音频录制（macOS 设备音频 / Windows WASAPI / Linux PulseAudio）
- 实时说话人区分（diarization）与多人会议重建
- 多模态上传：本地音频文件拖拽即可生成转录
- 原始音频与转录双向落库，任意环节可回溯

### 3. 个人知识库

- 笔记编辑器化：富文本编辑 + 多原始音频关联 + 内容指纹去重
- 本地语义搜索（Qdrant + MiniLM 向量索引 + FTS5 关键字双路召回 + RRF 融合）
- AI 增强：自动整理、总结、提炼行动项
- 完整可控的本地存储，导出格式灵活

### 4. Agent 数据中心

- 内置本地 MCP server（`@modelcontextprotocol/sdk`），把笔记、转录、搜索能力开放给任何 agent
- 支持 Codex、Claude Desktop、Cursor 等 MCP 客户端
- 配合自定义 LLM API（OpenAI / Anthropic / Gemini / DeepSeek / 通义 / 智谱 / Kimi）完成周报、纪要、复盘、问答
- 未来规划：本地 agent skill 化的工作流封装

## 快速开始

```bash
git clone https://github.com/sysusugan/superting.git
cd superting
npm install
npm run dev
```

要求 Node.js 24+。本仓库 `.nvmrc` 已固定 Node 版本。

## 常用命令

```bash
# 开发模式
npm run dev

# 仅构建 renderer
npm run build:renderer

# 打包本地未签名 App
npm run pack

# 类型检查
npm run typecheck
```

## 隐私说明

本分支会尽量坚持本地优先：

- 本地转录时，音频不需要离开你的设备。
- 本地模型、本地数据库、本地音频保留目录由用户设备管理。
- 如果使用云端模型或云转录服务，数据会发送到对应服务商，需自行确认服务商隐私策略。
- 后续接入国内模型和 MCP/agent 能力时，也会优先考虑可控、本地、可审计的数据流。

## 技术栈

- Electron 41
- React 19
- TypeScript
- Tailwind CSS v4
- better-sqlite3
- whisper.cpp
- sherpa-onnx / NVIDIA Parakeet
- Qdrant 本地向量检索
- shadcn/ui 与 Radix UI

## 与上游项目的关系

本仓库基于开源项目 OpenWhispr 继续开发，但从 SuperTing 改名开始作为独立分支维护，不再默认跟随上游分支。上游项目目标是提供 WisprFlow 和 Granola 的开源替代方案，支持跨平台语音听写、AI agent、会议转录和笔记能力。

本分支后续围绕中文用户、本地隐私、国内模型生态和个人知识库工作流做独立增强。

上游项目：

- Website: https://openwhispr.com
- Docs: https://docs.openwhispr.com
- GitHub: https://github.com/OpenWhispr/openwhispr

## 贡献约定

本分支提交要求：

- 使用 rebase 线性历史，避免 merge commit 分叉。
- 所有 commit 必须符合 DCO 规范，包含 `Signed-off-by`。
- 优先小步提交，保持 diff 可审查。
- 涉及行为变化时尽量补充测试。

推荐提交方式：

```bash
git commit -s -m "fix: describe the change"
```

## License

[MIT](LICENSE) — 可用于个人和商业场景。

## 致谢

- [OpenWhispr](https://github.com/OpenWhispr/openwhispr)
- [OpenAI Whisper](https://github.com/openai/whisper)
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
- [NVIDIA Parakeet](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
- [llama.cpp](https://github.com/ggerganov/llama.cpp)
- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [shadcn/ui](https://ui.shadcn.com/)
