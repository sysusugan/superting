# 推理配置持久化

## 目标与验收

- R1：从语言模型设置页面修改“听写清理”的自定义 API Key 后，完成保存并重启，仍能恢复该 Key。
- R2：该 Key 必须沿用主进程的安全存储，不写入 renderer 的 localStorage；清空 Key 也必须持久化。
- R3：保留其他推理范围及普通配置字段现有的保存与恢复行为。

本次不新增 IPC、改变密钥存储格式或迁移其他范围的密钥。

## 设计状态与基线

代码基线：`4e712f53`；核对日期：2026-11-06。
状态：已实现。回归测试先复现 R1、R2 失败，修复后通过。

## 组件职责与数据流

- `src/config/inferenceScopes.ts`：将四个推理范围的字段映射到 store 键。
- `src/components/settings/InferenceConfigEditor.tsx`：通过 `setResolvedLLMConfig` 保存页面修改。
- `src/stores/settingsStore.ts`：管理 renderer 状态、普通字段持久化及密钥 IPC 保存和启动恢复。
- `preload.js`、`src/helpers/ipcHandlers.js`：提供 `saveCleanupCustomKey` / `getCleanupCustomKey` 桥接。
- `src/helpers/environment.js`：使用既有安全存储机制保存 `CUSTOM_CLEANUP_API_KEY`。

### 根因

通用 `setResolvedLLMConfig` 原先对所有字段直接写 localStorage，绕过
`setCleanupCustomApiKey` 的防抖 IPC 保存及缓存失效逻辑。
`initializeSettings` 从主进程读取听写清理 Key，覆盖 renderer 的初始空值，并清理
`cleanupCustomApiKey` 的 localStorage 副本，因此新输入的 Key 没有进入恢复来源。
另外三个范围的自定义 Key 当前由 `readString` 从 localStorage 恢复，解释了症状差异。

### 修复设计

`setResolvedLLMConfig` 遇到映射后的 `cleanupCustomApiKey` 时，委托已有
`setCleanupCustomApiKey`，并跳过普通字段的 localStorage 写入。
状态立即更新，250ms 防抖后经 IPC 保存；启动时继续经主进程恢复。
同一 patch 的普通字段继续保存到 localStorage。空字符串沿用专用 setter 的清空语义。

## 兼容与失败处理

不变更接口、持久化格式或关键架构决策，不需新增 ADR。旧版已经清除且从未安全保存的
Key 无法从此修复中恢复，需重新输入。尚未被启动清理的旧 localStorage 副本不做额外迁移。
保存失败沿用既有 logger 警告；本次不改变保存防抖和退出行为，保存完成前退出的边界仍存在。
主进程加密后端及系统密钥链行为沿用现状。

## 验证方案

`test/stores/settingsStore.test.js` 使用真实 store 源码、真实范围映射和 Zustand，
隔离 localStorage、定时器及 Electron IPC。创建全新的 store 实例模拟重启，
仅保留磁盘侧的存储替身，全部使用虚构测试 Key。

- R1、R3：四个范围均通过页面使用的通用入口保存，再重新加载 store 并执行启动恢复。
- R2：断言页面入口调用密钥 IPC，且不生成 localStorage 明文副本；验证清空和连续修改。
- 对照：原有专用 setter 保存后可恢复，用于区分保存入口问题与启动读取问题。

实际验证（Node 24.21.0）：

- `node --test test/stores/settingsStore.test.js`：8/8 通过。修复前为 4/6 通过，失败项为听写清理重启恢复和禁止明文写入；另两个边界测试随后补充。
- `cd src && tsc --noEmit`：通过。
- 针对修改的 store 和测试文件运行 ESLint：通过。
- Prettier：新增测试与本文档通过；store 存在基线已有的四处模式校验格式问题，本次四行修改不引入额外格式差异。
- `git diff --check`：通过。

此测试不等同于 OS 密钥链的保存恢复端到端验证；没有使用真实 Key 进行写入测试。

## 2026-11-08 构建与安装

- 修复提交 `62da0684` 已通过 rebase 检查及快进方式合入 `main` 并推送；构建源码与该 `main` 提交一致。
- 复跑上述回归测试，8/8 通过。
- 本机 arm64 安装版本：`26.1108.2031`。沿用 `scripts/package-mac.js` 的流程和上海时区版本生成规则，命令行设置 `mac.identity=-`，使用 ad-hoc 签名。
- 复用本地二进制、模型、图标和依赖；依赖采用实体目录副本。首次以 node_modules 符号链接构建时缺少 `file-uri-to-path`，该失败包未安装。
- 新包通过 packaged better-sqlite3 JS 入口与原生模块加载、`hdiutil verify`、`codesign --verify --deep --strict`。
- 已核对 app.asar 的版本与 renderer 中的安全保存修复。安装后的 `CFBundleShortVersionString`、`CFBundleVersion` 均为 `26.1108.2031`。
- 已正常退出旧版，安装到 `/Applications/SuperTing.app` 并启动；观察到控制面板正常显示。
- 安装包保存在主工作区 `dist/SuperTing-26.1108.2031-arm64.dmg`；旧 App 备份在 `~/Library/Application Support/SuperTing-install-backups/26.1108.2031/SuperTing.app`。
- 此次未更改用户密钥或执行真实 API 调用；重输真实 Key 后跨重启使用仍需用户验证。没有改变关键架构决策。
