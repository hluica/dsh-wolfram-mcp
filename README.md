# dsh-wolfram-mcp

最后实质性修改于Harness版本：0.2.2-rc.3

把本机 Wolfram Language 安装接入 DeepSeek Harness：插件启用时自动把 Wolfram kernel 生成的 MCP 配置注册为 DSH MCP 服务器，并把随插件携带的四个 Wolfram Agent Skills 复制到全局 Skills 目录。配置只在首次安装后从 kernel 获取一次并持久化，之后可在 Settings → Wolfram MCP 中手动重新获取。

## 使用与效果

1. 安装并启用插件。
2. 若本机存在 `wolframscript` 与 Wolfram app，插件会在后台运行一次 kernel 配置生成，把结果写入 `$DSH_HOME/dsh-wolfram-mcp/state.json`，并以 `WolframLanguage` 为命名空间注册 MCP 服务器。
3. 连接成功后，模型工具列表出现 `mcp__WolframLanguage__*`（例如 `WolframLanguageEvaluator`、`WolframLanguageContext`）。
4. 四个 skill 被复制到 `$DSH_HOME/skills/`：`wolfram-language`、`wolfram-notebooks`、`wolfram-paclets`、`wolfram-debugging`。下一次模型步骤即可在 skill 目录中看到它们。
5. Settings → **Wolfram MCP** 页面展示当前持久化的配置 JSON（只读）与 MCP 连接状态；点击 **重新获取配置** 可手动运行一次 `wolframscript` 并替换配置。
6. 禁用或卸载插件时，插件注册的 MCP 服务器与其工具被撤除，四个 skill 副本也被移除。持久化状态文件保留，重新启用时直接读取，不会再次自动运行 kernel。

> 首次启用时后台生成约需 25 秒；首次启动 MCP 服务器还可能下载/加载 Wolfram 内容，工具出现时间会更晚。页面会显示 `refreshing` 与 MCP 连接状态。

## 工作原理

### 安装检测

- 在 `PATH` 与常见路径中查找可执行的 `wolframscript`；在 `/Applications`、`~/Applications` 中查找带 `Contents/MacOS/wolfram` 或 `WolframKernel` 的 Wolfram app bundle。
- 没有 `wolframscript` 时不启动 kernel；生成结果里的 `command` 必须是存在且可执行的文件，否则跳过该服务器。未安装 Wolfram 时不做任何 MCP 注册。
- 检测到未安装时仍会复制 Skills，因为四个 skill 内含 `GetWolframEngine.md` 等安装指引。

### 配置生成与转换

生成表达式固定为：

```wl
PacletSymbol["Wolfram/AgentTools", "Wolfram`AgentTools`MCPServerObject"]["WolframLanguage"]["JSONConfiguration"]
```

- 主路径使用 `wolframscript -code 'WriteString["stdout", …]'`；本机 WolframScript 的裸 `-code` 结果不打印到 stdout，因此显式写入 stdout。
- 回退顺序：需求中的精确命令 → `Export[临时文件, …, "Text"]` 后读取。三条路径共享总计 6 分钟预算。
- 解析出的 `mcpServers` 逐项转换为 DSH `mcpManager.register()` 的注册项：`stdio` 映射 `command`/`args`/`env`/可选 `cwd`，`streamable-http` 映射 `url`/`headers`；统一设置 `startupTimeoutMs: 600000`，以覆盖 Wolfram 首次预热。
- 注册名取自生成 JSON 的 key，必须匹配 `^[A-Za-z0-9_-]{1,32}$`。注册失败（名称冲突、字段非法等）只影响该项，不影响插件本身。

### 持久化与手动刷新

状态文件：

```text
$DSH_HOME/dsh-wolfram-mcp/state.json
```

包含 `config`、`fetchedAt`、`lastAttemptAt`、`lastSource`、`lastError`、`wolframscript`、`wolframApp`。写入使用同目录临时文件 + `rename` 原子替换。

- 首次启用且状态文件不存在：执行一次 `initial` 生成。
- 后续启用：只读取状态文件并注册，不再自动运行 kernel。
- 首次生成失败：错误也写入状态文件；下一次启用不会自动重试，需在设置页手动点击重新获取。
- 手动刷新成功：替换状态文件；配置与当前一致时跳过重注册，避免工具空窗；配置变化时先卸载旧实例再挂载新实例。
- 手动刷新失败或新配置没有可注册服务器：保留上一份有效配置与注册，仅在页面显示错误。
- 状态文件写入失败时，内存注册仍生效，页面标记 `persisted: false` 并显示路径。

### Skills 复制与清理

- 源目录：插件包内 `src/Skills/`。
- 目标目录：`$DSH_HOME/skills`（`$DSH_HOME` 为空时用 `~/.dsh`）。
- 每个被复制的 skill 目录写隐藏标记 `.dsh-wolfram-mcp.json`，包含插件 id、版本与本次启用的唯一 token。
- 目标已存在且带本插件标记：视为旧副本，整体替换；目标已存在但无本插件标记：视为用户或其他工具所有，跳过并输出 warning，绝不覆盖。
- 卸载时只删除“标记存在且 token 与本次启用一致”的目录，避免热重载时旧实例误删新副本；目标根目录本身不删除。
- 全局 Skills 目录不可创建/不可写时静默放弃，不影响 MCP 注册。

### Settings 页面

- Client 通过 `settings.section` 注册 `id: wolfram-mcp` 页面，并在 `settings.section.icon` 注册同 id 的导航图标。
- Host 提供 owner-only HTTP API：
  - `GET /dsh-wolfram-mcp/api/state`：返回配置、时间、路径、`refreshing`、`persisted`、MCP 状态与 Skills 复制结果。
  - `POST /dsh-wolfram-mcp/api/refresh`：串行触发一次生成；并发请求复用同一操作。
- 页面每 3 秒轮询一次状态，以覆盖首次后台生成与 MCP 连接状态变化；组件卸载时清除定时器。
- 页面文本走 Client `ctx.locale` 字典（中文/英文），样式只使用 `--dsw-alias-*` 主题 token。

## 依赖与构建

本插件没有运行时 npm 依赖：Host 端只使用 `node:*` 内置模块与 `ctx.mcpManager`、`ctx.webServer`、`ctx.connection`；Client 端只使用注入的 `ctx.slots`、`ctx.locale` 与 `react` 模块表中的 React。

插件自带与 [build-system](../build-system/) 参考副本一致的构建脚本（`build.mjs`、`verify.mjs`、`lib/fsx.mjs`、`lib/tar.mjs`、`lib/probe-runner.mjs`），`scripts/host-contract.mjs` 是本插件自有探针。

```bash
npm test        # node --test test/*.test.mjs
npm run build   # 物化依赖（无依赖时清理 node_modules）并运行 verify
npm run verify  # 仅运行不变量检查
npm run clean   # 清理构建产物
```

安装方式：在 **Plugins** 页面选择本地目录，或由 `plugin_manager` 以 `install_bundle` 指向本目录。开发环境的本地安装是 `link:` 挂载，代码修改后重启 DSH 生效。

## 适用范围与边界

- macOS 优先；Linux/Windows 只要 `wolframscript` 可用并输出同样结构即可工作，但 app bundle 检测不保证。
- 只处理本地 stdio Wolfram MCP；不接入 Wolfram Cloud MCP，不提供 OAuth。
- 不安装或更新 Wolfram Engine/AgentTools，不调用 `DeployAgentTools`，不修改 Wolfram 安装目录。
- `src/wolframlanguage_mcp.json` 是测试夹具，运行时不会用它替代 kernel 输出。
- 状态文件有意跨禁用/卸载保留；要彻底清理需手动删除 `$DSH_HOME/dsh-wolfram-mcp/`。
- 如果 DSH 在关闭状态下卸载插件，skill 副本没有进程可清理，会残留到下次启用；下次启用会用新 token 替换本插件标记的目录，不会动用户目录。
- 若用户或 Wolfram 官方已把同名 skill 安装到 `$DSH_HOME/skills`，本插件跳过该 skill，不覆盖。

## 故障排查

1. **没有 `mcp__WolframLanguage__*` 工具**
   - 打开 Settings → Wolfram MCP，看 `最近错误` 与 `MCP 服务器` 状态。
   - 确认 `wolframscript` 路径与 Wolfram app 路径；确认 `state.json` 存在。
   - 在终端手动执行生成命令：
     ```bash
     wolframscript -code 'WriteString["stdout", PacletSymbol["Wolfram/AgentTools", "Wolfram`AgentTools`MCPServerObject"]["WolframLanguage"]["JSONConfiguration"]]'
     ```
     应输出一个包含 `mcpServers.WolframLanguage` 的 JSON。
2. **首次获取失败后一直不自动重试**
   - 这是刻意行为：失败状态已持久化。修好 Wolfram 环境后点击设置页的 **重新获取配置**。
3. **想强制重新获取**
   - 删除 `$DSH_HOME/dsh-wolfram-mcp/state.json` 后重新启用插件，会把下一次启用当作首次安装并生成一次；也可以直接点设置页按钮。
4. **Skills 没出现**
   - 检查 `$DSH_HOME/skills/<name>/SKILL.md`；若目标已存在且不是本插件复制的，插件会跳过并在设置页显示 `已跳过`。
   - 若全局目录不可写，插件静默放弃复制；修复权限后重新启用。
5. **MCP 服务器启动慢或失败**
   - Wolfram 首次启动会加载 paclet/索引，日志在 `$WOLFRAM_USERBASE/Logs/AgentTools/Output/`（生成配置的 `env` 中有 `WOLFRAM_USERBASE`）。
   - 首次下载 Chatbook 向量数据库可能需要约 10 分钟；插件给 MCP 实例设置了 10 分钟 `startupTimeoutMs`。若启动预算刚好耗尽，`mcp-client` 会按自身 reconnect 策略重连；下载文件已在磁盘上，通常重连后即可连接。后续启动使用缓存，会明显加快。
   - 若仍失败，查看设置页的 MCP 状态与 DSH Host 日志。
6. **完整清理**
   - 禁用插件会移除 MCP 注册与带标记的 skill 副本。
   - 手动删除 `$DSH_HOME/dsh-wolfram-mcp/` 可清除持久化配置；删除 `$DSH_HOME/skills/` 下带 `.dsh-wolfram-mcp.json` 的目录可清除残留副本。

## 插件特有操作

- **重新获取配置**：Settings → Wolfram MCP → 重新获取配置。成功后会更新状态文件并重注册；失败时旧配置与旧注册保留。
- **查看原始配置**：同一页面的只读文本框显示 `state.json` 中 `config` 的格式化 JSON。
- **查看状态文件路径**：页面“状态文件”一栏；也可直接查看 `$DSH_HOME/dsh-wolfram-mcp/state.json`。
- **插件身份**：Loader entry id 与 bundle patch id 均为 `dsh-wolfram-mcp`；包名 `@local/dsh-wolfram-mcp`。

## 相关文档

- [FEASIBILITY@0.2.2-rc.3.md](FEASIBILITY@0.2.2-rc.3.md)：调研依据、方案取舍、实施记录与验证结果。
