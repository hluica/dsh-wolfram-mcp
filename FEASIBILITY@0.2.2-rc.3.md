# 自动接入本地 Wolfram Language MCP 服务器与 Wolfram Agent Skills

## 2026-11-18 新插件 `dsh-wolfram-mcp` 方案

### 目的与范围

新建本地插件 `dsh-wolfram-mcp`，在 DSH（Harness `0.2.2-rc.3`，Desktop profile）中完成四件事：

1. **启用即注册、禁用即移除**：插件启用后自动向当前 Host 注册 Wolfram Language MCP 服务器；禁用或卸载后，注册的服务器及其工具自动撤除，不残留配置。
2. **只在确有安装时动作**：检测本机 `wolframscript` 与 Wolfram app（macOS 为 `Wolfram.app` / Wolfram Engine 等 app bundle）的安装情况；任一必要条件不满足时，不注册 MCP 服务器。
3. **参数来自 Wolfram kernel，不写死**：存在 `wolframscript` 时运行同一 PacletSymbol 表达式，读取 kernel 生成的 JSON MCP 配置，再转换为 DSH 的 `mcpManager` 注册项；命令、参数、环境变量均以生成结果为准。
4. **Skills 副本**：随插件携带 `src/Skills/` 下的四个 Wolfram agent skills；启用时复制到 DSH 全局 Skills 目录（`$DSH_HOME/skills`），禁用/卸载时移除旧插件副本。全局目录不可写、或目标 skill 目录不属于本插件时，静默放弃该次复制。

边界与取舍：

- 只处理**本地 stdio** Wolfram MCP 服务器；不接入 Wolfram Cloud MCP，不提供 OAuth/远程服务器管理。
- 不修改 Wolfram 安装，不代替用户安装 Wolfram Engine/AgentTools，不调用 `DeployAgentTools`；插件只读取 kernel 给出的配置。
- 不落盘保存生成的 MCP 配置，不把 `src/wolframlanguage_mcp.json` 当作运行时回退；该文件仅作为测试夹具（见下文“问题与解决办法”）。
- v0.1 不提供 Settings/UI、不提供 Config 字段；插件行为固定，避免为几个可调项引入 `@deepseek-ai/schemastery` 依赖和额外 UI 契约。
- macOS 优先；其他平台只要 `wolframscript` 可用并按同样协议输出 JSON，也能工作，但不承诺 app bundle 检测。

### 可行性

#### 1. DSH 提供了插件级 MCP 注册服务

- 当前 Desktop profile 已挂载 `@deepseek-ai/dsh-mcp-manager`。`cordis_inspect_query` 的 `Config.listConfigs` 返回 `include:mcp-manager`（`patchId: mcp-manager`），`Service.listService` 返回 `mcpManager` 服务及 `register(name, entry): () => void` 的精确签名。
- `@deepseek-ai/dsh-mcp-manager` 的 README “Registering a server from a plugin” 明确说明：插件应调用 `ctx.mcpManager.register(name, entry)`，而不是写配置；注册的生命周期属于调用插件，禁用或卸载插件会卸载服务器并撤除其工具。
- 上游源码 `node_modules/@deepseek-ai/dsh-mcp-manager/src/index.ts` 中，`McpServerManager.register()` 使用调用方上下文创建 effect，并对名称、传输字段、模板语法和 reconnect 参数做与配置项相同的校验；注册项不允许 `enabled` 字段（注册即启用）。
- 上游源码 `node_modules/@deepseek-ai/dsh-mcp-client/src/index.ts` 定义了 `serverName` 约束 `^[A-Za-z0-9_-]{1,32}$`、`startupTimeoutMs`、`toolCallTimeoutMs` 与 stdio 的 `command/args/env/cwd` 字段，正好覆盖 Wolfram 生成的 `mcpServers` 结构。

结论：不需要写 profile 的 `cordis.patch.yml` 或持久化配置；插件在运行时注册即可，且自动清理有官方契约。

#### 2. 全局 Skills 目录确实存在且可被 DSH 发现

- `@deepseek-ai/dsh-skill-filesystem` 的根目录顺序中，`user-dsh` 位于 rank 400，路径为 `<dshHome>/skills`；`dshHome` 由 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome()` 解析：显式配置 > `$DSH_HOME` > `~/.dsh`。
- 当前会话 `DSH_HOME=/Users/hanluica/.dsh`，`~/.dsh/skills` 目前不存在，因此插件创建该目录并把 skill 目录直接放在其下即可被下一轮 catalog 发现；该 provider 会监听根目录，缺失根目录也会轮询等待创建。
- 目录布局要求是 `<root>/<name>/SKILL.md` 或 `<root>/<name>.md`，`src/Skills/` 下四个目录均满足。

结论：复制到 `$DSH_HOME/skills` 可行；若目录不可写（权限、只读挂载等），按需求静默放弃。

#### 3. 本地 Wolfram 环境与生成命令

实测环境：

- `/usr/local/bin/wolframscript` -> `/Applications/WolframScript.app/Contents/MacOS/wolframscript`，`-version` 输出 `WolframScript 1.14.0 for Mac OS X ARM (64-bit)`。
- `/Applications/Wolfram.app` 存在，`CFBundleShortVersionString = 15.0.1`；`Contents/MacOS/` 内有 `wolfram`、`WolframKernel`、`wolframscript`。生成配置中的命令路径 `/Applications/Wolfram.app/Contents/MacOS/wolfram` 确实存在。
- 内置 AgentTools paclet 版本为 `2.1.17`，包含 `Wolfram`AgentTools`StartMCPServer` 与 `MCPServerObject`。

生成命令的实测差异：

- 直接执行需求中的 `wolframscript -code 'PacletSymbol["Wolfram/AgentTools", "Wolfram`AgentTools`MCPServerObject"]["WolframLanguage"]["JSONConfiguration"]'`，在本机 **stdout 为空**（exit 0），无法直接拿到 JSON；`Print[2+2]` 同样没有输出，但 `Export[...]` 能正常求值。这是本机 WolframScript 与 kernel 的 stdout 捕获差异，不是 paclet 缺失。
- 将同一表达式包在 `WriteString["stdout", ...]` 中即可得到完整 JSON：`wolframscript -code 'WriteString["stdout", PacletSymbol[...][...]]'`，耗时约 24.7 秒，输出与工作区 `src/wolframlanguage_mcp.json` 的结构、命令、args、env 完全一致。
- 生成结果形如：

```json
{
  "mcpServers": {
    "WolframLanguage": {
      "type": "stdio",
      "command": "/Applications/Wolfram.app/Contents/MacOS/wolfram",
      "args": ["-run", "PacletSymbol[\"Wolfram/AgentTools\",\"Wolfram`AgentTools`StartMCPServer\"][]", "-noinit", "-noprompt"],
      "env": {
        "MCP_SERVER_NAME": "WolframLanguage",
        "WOLFRAM_BASE": "/Library/Wolfram",
        "WOLFRAM_LOCALBASE": "/Users/hanluica/Library/Wolfram/Objects",
        "WOLFRAM_USERBASE": "/Users/hanluica/Library/Wolfram"
      }
    }
  }
}
```

结论：从 kernel 生成并解析 JSON 可行；需要以 `WriteString["stdout", ...]` 作为主路径，并保留精确原命令与 `Export` 两条回退路径。

#### 4. MCP 服务器首次启动的耗时与噪音

- 用生成出的命令做手工 stdio 探测时，服务器首次启动会打印 `Loading from Wolfram Research server…` 进度到 stdout，并需要下载/加载 AgentTools 相关内容；120 秒内未完成，属首次预热的预期行为。
- DSH 使用的 MCP SDK `@modelcontextprotocol/client` 的 `ReadBuffer.readMessage()` 对非 JSON 行只吞掉 `SyntaxError` 后继续，因此这些进度行不会破坏 MCP 握手；真正需要的是足够的 `startupTimeoutMs`。
- 手工探测时工作区文件沙箱拒绝写 `~/Library/Wolfram/Logs`，导致 `StartMCPServer` 提前返回；使用完整权限后该目录被创建，服务器进入加载阶段。插件运行在 Host 进程内，不受会话工作区沙箱限制，因此运行时不应受此影响；这一点需在阶段二用真实 Host 验证。

结论：可注册，但注册项应显式设置较宽松的 `startupTimeoutMs`（建议 `600000`，即 10 分钟）；首次启动可能较慢，之后应显著加快。

#### 5. 构建系统与清单契约

- `BUILD-SYSTEM.md` 要求每个插件有独立的 `package.json`、`cordis.patch.yml`、`icon.svg`、`locale/en.json` 与 `client.js`；`verify` 会检查 `exports`、`dsh.bundle.patch`、`dsh.client.platform === 'web'`、locale `meta.title`、icon 大小与 `files[]`。
- `verify` 对无外部依赖的插件要求 `node_modules/` 与 `deps.lock.json` 均不存在；本插件只使用 `node:*` 内置模块和 `ctx.mcpManager`，可以做到零依赖。
- 本地安装（Desktop 开发环境）以 `link:<插件目录>` 挂载，`src/Skills` 可直接按 `import.meta.url` 定位；同时把 `src/Skills` 列入 `files[]`，兼容将来按包内容复制安装的场景。

### 核心进路

#### 选定方案

1. **清单与挂载**
   - 包名 `@local/dsh-wolfram-mcp`，版本 `0.1.0`，`private: true`，零运行时依赖。
   - `cordis.patch.yml` 插入一行：`id: dsh-wolfram-mcp`、`name: '@local/dsh-wolfram-mcp'`。
   - Host 入口 `index.js` 导出 `PLUGIN_ID = 'dsh-wolfram-mcp'`、`inject = ['mcpManager']` 和 `apply(ctx)`。
   - `client.js` 只做最小合法注册（`window.__ModuleLoader__.load({ id, factory })`），不挂任何 UI；`dsh.client` 声明 `platform: 'web'`、`inject: []`，满足构建系统对 Client 半边的契约。

2. **安装检测与生成**
   - `findWolframScript()`：按 `PATH` 与固定候选（`/usr/local/bin`、`/opt/homebrew/bin`、`Wolfram.app/Contents/MacOS`、`WolframScript.app/Contents/MacOS`、Linux 常见路径）查找可执行的 `wolframscript`；同时用 `findWolframApp()` 检查 `/Applications`、`~/Applications` 下 Wolfram app bundle 的 `Contents/MacOS/wolfram` 或 `WolframKernel`，用于日志与“未安装”判定。
   - 只要没有可执行的 `wolframscript`，就不启动 kernel；若 app 也不存在，只记录 debug 日志后返回。
   - 生成表达式固定为 `PacletSymbol["Wolfram/AgentTools", "Wolfram`AgentTools`MCPServerObject"]["WolframLanguage"]["JSONConfiguration"]`。
   - 主路径：`wolframscript -code 'WriteString["stdout", <表达式>]'`，`execFile` 超时 120 秒、`maxBuffer` 1 MiB、可被插件卸载信号中止。
   - 回退 1：精确按需求命令执行（未来版本若自行打印结果可直接解析）。
   - 回退 2：`Export[临时文件, <表达式>, "Text"]` 后读取并删除临时文件，规避 stdout 异常。
   - 解析时先 `JSON.parse` 整个 trim 后的文本，失败再从首个 `{` 到末个 `}` 截取重试；仍失败则放弃并告警。

3. **转换为 DSH 注册项**
   - 遍历 `mcpServers` 的每个键值：
     - 键必须满足 `^[A-Za-z0-9_-]{1,32}$`，否则跳过并告警；不擅自改名，避免工具名不可预测。
     - `type: "stdio"`（或缺失但存在 `command`）：映射为 `{ transport: 'stdio', command, args, env, ...(cwd ? { cwd } : {}) }`；`args` 只保留字符串，`env` 只保留字符串值。
     - `type: "streamable-http"` / `"http"`：映射为 `{ transport: 'streamable-http', url, headers }`，作为未来兼容路径。
     - 统一追加 `startupTimeoutMs: 600000`；不设置 `toolCallTimeoutMs`，沿用 `dsh-mcp-client` 默认值。
     - stdio 的 `command` 必须是存在且可执行的文件；否则跳过该服务器（满足“只在确认安装时注册”）。
   - 对每个合法条目调用 `ctx.mcpManager.register(name, entry)`；单个条目失败（名称冲突、校验失败等）只告警，不影响其他条目或插件本身。

4. **异步注册，避免拖慢 Host 启动**
   - `apply()` 本身不 `await` kernel 生成，而是同步完成 Skills 复制并启动一个后台任务；生成（约 25 秒，首次可能更久）完成后才注册 MCP 服务器。
   - 用 `AbortController` 关联插件生命周期；插件卸载时先 abort，再调用已注册条目的 disposer，最后移除 Skills 副本。
   - 生成失败、超时、未找到 `wolframscript`、解析失败时，只写 `ctx.logger.warn/debug`，不让插件激活失败；下次启用/重启会重试。

5. **Skills 复制与移除**
   - 源：`path.join(pluginDir, 'src', 'Skills')`；目标根：`resolveDshHome()/skills`（`$DSH_HOME` 优先，否则 `~/.dsh`）。
   - 逐个子目录复制 `<name>/` 到目标；每个复制目录写隐藏标记 `.dsh-wolfram-mcp.json`（内容含插件 id、版本与本次启用的唯一 `token`）。
   - 目标已存在时：
     - 有本插件标记：视为旧副本，整体替换（支持插件升级）。
     - 无本插件标记：视为用户或其他工具所有，跳过并告警，绝不覆盖。
   - 目标根不可创建或复制失败：捕获后静默返回，不影响 MCP 注册。
   - 卸载时只删除“标记存在且 `token` 等于本实例 token”的目录；不删除目标根，也不删除用户目录。这样插件热重载/升级时，旧实例的清理不会误删新实例刚写入的副本。若 DSH 在关闭状态下卸载插件，标记目录会残留，README 给出一次性清理说明。

#### 备选方案与不采用原因

- **只用配置型 bundle 写静态 `dsh-mcp-client` 行**：无法按本机情况生成参数，且禁用后无法自动移除配置；不满足需求。
- **在 `cordis.patch.yml` 中直接写 `command/args/env`**：等于写死字符串，换机器/换版本即失效；不满足“从 kernel 生成”。
- **Host 端直接 `import '@deepseek-ai/dsh-mcp-client'` 并自行 mount**：需要把该包作为依赖 vendoring，且要自行处理 connection 生命周期；`mcpManager` 已封装这些行为，重复实现没有收益。
- **同步等待生成再返回 `apply`**：本机约 25 秒，首次更久；会阻塞 Host 启动，故不采用。
- **缓存上次生成结果以加速后续启动**：可行，但要额外处理命令路径失效、缓存与新鲜结果的差异以及热重载替换竞态；v0.1 先不引入，后续可作为性能优化。
- **用 `src/wolframlanguage_mcp.json` 作运行时回退**：该文件含本机绝对路径和用户名，换机器即错误，且会掩盖 kernel 故障；因此只作测试夹具，运行时只信任新鲜生成结果。

#### 阶段二验证计划

1. 单元测试（`node --test`）：
   - 用 `src/wolframlanguage_mcp.json` 验证解析与转换结果（命令、args、env、`startupTimeoutMs`）。
   - 空输出、带进度噪音、缺字段、非法 server 名、`command` 不存在等异常路径。
   - 在临时 `DSH_HOME` 中验证 Skills 复制、重复复制（升级）、卸载移除、用户目录不被覆盖、根不可写时静默返回。
   - 检测函数在临时目录/伪造 PATH 下的行为。
2. `npm run build`（含 `verify` 与 `scripts/host-contract.mjs` 探针）。
3. 通过 `plugin_manager install_bundle` 安装并启用；等待生成完成后用 `cordis_inspect_query` 的 `Tool.listTools` 确认出现 `mcp__WolframLanguage__*`。
4. 确认 `~/.dsh/skills/wolfram-language/SKILL.md` 等四个目录与标记存在，并出现在下一次会话的 skill catalog 中。
5. 禁用插件，确认 MCP 工具消失、四个 skill 目录被移除；再启用一次确认可恢复。
6. 若运行时验证必须重启 DSH，按 `AGENTS.md` 4.2 先完成文档/提交，再提示用户重启并结束轮次。

### 问题与解决办法

| 预判问题 | 确证方式/原因 | 拟定修法 |
|---|---|---|
| 需求给出的 `wolframscript -code '...'` 在本机 stdout 为空 | 已实测：`Print`/裸表达式无输出，`WriteString["stdout", ...]` 正常 | 主路径改用 `WriteString`；保留精确命令与 `Export` 回退 |
| 生成耗时约 25 秒，首次可能数分钟 | 已实测生成 24.7 秒；首次 MCP 启动加载 Wolfram Research 内容超过 120 秒 | `apply` 后台执行；注册项 `startupTimeoutMs: 600000`；日志说明首次较慢 |
| Wolfram 首次启动向 stdout 打进度行 | 已实测 `Loading from Wolfram Research server…` | 已核实 MCP SDK 对非 JSON 行只跳过 `SyntaxError`；无需额外过滤，必要时日志记录 |
| 手工探测在 workspace-write 沙箱下失败 | `~/Library/Wolfram/Logs` 无法创建 | 属会话沙箱限制；插件在 Host 进程运行，阶段二用真实 Host 验证并记录 |
| `serverName` 冲突（用户已配置同名服务器） | `mcpManager.register` 会抛错 | 捕获、`warn`、跳过该条目；不覆盖用户配置 |
| Skills 目标目录已被用户/Wolfram 官方部署占用 | 目标存在但无本插件标记 | 跳过并告警；移除时只删带标记目录，避免误删 |
| 全局 Skills 目录不可写 | `mkdir/cp` 抛错 | 最外层 try/catch 静默放弃；不影响 MCP 功能 |
| 插件热重载/升级时旧实例清理误删新副本 | 旧、新实例会先后复制同名 skill 目录 | 标记写入本次启用的唯一 `token`，清理只删除 token 相同的目录 |
| 插件在 DSH 关闭时被卸载，Skills 残留 | 无进程执行清理 | README 说明按 `.dsh-wolfram-mcp.json` 标记手动清理；下次启用会替换旧副本 |
| 插件源目录含 `.DS_Store` | 工作区 `src/Skills` 现有 macOS 边角文件 | 阶段二删除这些文件；`.gitignore` 已忽略 `.DS_Store`；复制时也跳过 |
| 示例 JSON 的绝对路径不具可移植性 | 含 `/Users/hanluica/...` | 只用于测试夹具，不参与运行时注册 |

### 待确认

阶段一已完成调研，尚未修改源码。进入阶段二前请确认以下三点取舍：

1. **Skills 是否在未安装 Wolfram 时也复制？** 拟定：是。四个 skill 内含 `GetWolframEngine.md` 等安装指引，未安装时仍有参考价值；`未安装则什么都不做` 仅约束 MCP 注册。若希望严格“未安装则连 Skills 也不动”，请说明。
2. **MCP 注册是否接受后台异步完成？** 拟定：是。插件启用后约 25 秒（首次更久）才出现 Wolfram 工具；Host 启动不被阻塞。若必须“启用时同步完成注册”，则需要接受启动延迟。
3. **v0.1 是否保持无 Config/无 UI？** 拟定：是。暂不提供 `wolframscriptPath`、`copySkills` 等配置项；后续有需要再以 SemVer 增量加入。
4. **`src/wolframlanguage_mcp.json` 是否只作测试夹具？** 拟定：是。运行时只信任 kernel 新鲜生成结果；若希望它在 `wolframscript` 生成失败时作为本机回退（会带入绝对路径与用户名），请说明。

## 2026-11-18 持久化配置与设置页（阶段二修订）

### 目的与范围

在阶段一方案基础上调整 MCP 配置的获取时机，并增加一个插件自有设置页：

1. **只在安装后获取一次**：首次启用且本地没有持久化状态时，运行 `wolframscript` 生成一次 MCP 配置并写入 `$DSH_HOME/dsh-wolfram-mcp/state.json`；此后每次启用只读取该文件并注册，不再自动运行 kernel。配置生成失败也写入状态（含错误），下次启用不自动重试。
2. **手动重新获取**：设置页提供一个按钮，显式触发一次重新生成；成功后原子替换持久化状态并重注册 MCP 服务器。把“不再自动获取”与“可人工更新”分开。
3. **设置页**：在 `settings.section` 增加新页面，展示当前持久化配置 JSON（只读文本区域），并显示最近获取/尝试时间、来源、WolframScript/Wolfram app 路径、状态文件路径、MCP 连接状态和最近错误。
4. **前一轮三个拟定项确认**：Skills 在未安装 Wolfram 时也复制；MCP 注册允许后台异步完成；`src/wolframlanguage_mcp.json` 仅作测试夹具。v0.1 仍不提供插件 Config 字段（设置页是自定义 UI，不是 Config 表单）。

边界：设置页只管理本插件自己的状态文件与 MCP 注册，不编辑 profile 配置、不修改 Wolfram 安装；状态文件在禁用/卸载后保留，以保证重新启用时不重新获取。

### 可行性

- **设置页槽位**：`cordis_inspect_query` 的 `Slots.listSubTree({ root: 'settings.section' })` 确认 `settings.section` 是 root 作用域的 list 槽位，注册选项为 `id`、`order`、`label`，owner props 只有 `{ close }`；`settings.section.icon` 为同 id 的可选导航图标槽位，owner props 为 `{ size, active }`。现有 `dsh-agent-preset-text` 已用相同方式注册设置页。
- **客户端本地化**：`ctx.locale.register(ns, { zh, en })`、`ctx.locale.bind(ns)`、`ctx.locale.subscribe()` / `getSnapshot()` 均在 Client `locale` 服务上可用；`dsh-font-settings` 等本地插件已按该模式接入。
- **Host ↔ Client 通道**：`ctx.webServer.register({ kind: 'prefix', path, handler })` 与 `ctx.connection.admit(req)` 是本地插件已验证的模式（`dsh-session-deleater` 的 `/session-deleater/api` 路由）；浏览器端用同源 `fetch` 即可，不需要新增 Remote/Typert 定义，也不依赖生成代码。
- **持久化位置**：`$DSH_HOME` 由环境变量或 `~/.dsh` 确定（`@deepseek-ai/dsh-home-paths` 的 `resolveDshHome` 规则）。插件自有的 `$DSH_HOME/dsh-wolfram-mcp/state.json` 与全局 Skills 根 `$DSH_HOME/skills` 分离，便于用户检查/删除。
- **MCP 状态展示**：`ctx.mcpManager.list()` 返回 `McpManagedServerView[]`，含 `name`、`configured` 与 `status` 联合类型（`connected` 时有 `toolCount`）；注册名可用来过滤出本插件的服务器并展示连接状态。

### 核心进路

**状态文件** `$DSH_HOME/dsh-wolfram-mcp/state.json`：

```json
{
  "schemaVersion": 1,
  "config": { "mcpServers": { } },
  "fetchedAt": "2026-11-18T...Z",
  "lastAttemptAt": "2026-11-18T...Z",
  "lastSource": "initial",
  "lastError": null,
  "wolframscript": "/usr/local/bin/wolframscript",
  "wolframApp": "/Applications/Wolfram.app"
}
```

- `config` 为 kernel 输出解析后的完整对象；设置页展示其格式化 JSON。
- 成功生成但没有任何可注册服务器时，不覆盖上一份有效 `config`，只在 `lastError` 记录原因；首次生成失败时 `config` 为 `null`。
- 写入使用同目录临时文件 + `rename` 的原子替换；写入失败时保留内存状态并在 UI 标记 `persisted: false`，但不影响本次注册。

**启用流程**：

1. 读取状态文件。
2. 有合法 `config`：立即转换为 `mcpManager.register()` 并注册（无需等 kernel，启动快）。
3. 状态文件不存在或损坏：后台执行一次 `refreshNow('initial')`，生成、持久化、注册；不阻塞 `apply()`。
4. 状态文件存在但 `config` 为 `null`（上次生成失败）：不自动重试，设置页显示 `lastError`，等待用户点按钮。
5. 每次启用都复制 Skills（与 Wolfram 是否安装无关），禁用时按标记 token 清理。

**手动刷新 API**（owner-only，沿用 `ctx.connection.admit`）：

- `GET /dsh-wolfram-mcp/api/state`：返回快照（config、时间、错误、路径、`refreshing`、`persisted`、`mcpServers` 状态、已复制 Skills）。
- `POST /dsh-wolfram-mcp/api/refresh`：串行执行一次生成；并发请求复用同一个进行中的 Promise；完成后返回同一份快照。
- 生成失败、找不到 `wolframscript`、解析失败、无有效条目时，保留上一份有效配置与注册，只在 `lastError` 更新；首次失败则保持 `config: null`。

**生成与转换**：沿用阶段一的 `WriteString["stdout", ...]` 主路径与精确命令/`Export` 回退；解析后转换为 `mcpManager` 注册项（`stdio`，`startupTimeoutMs: 600000`，校验 `command` 可执行）。若新配置与当前配置 JSON 等价，则跳过重注册以避免工具空窗。

**设置页**：在 `settings.section` 注册 `id: wolfram-mcp`、`order: 22`，并注册同 id 的 16px 导航图标。页面内容：

- 顶部标题与说明；
- 状态信息（来源、最近获取、最近尝试、状态文件、WolframScript、Wolfram app）；
- `textarea` 只读展示 `JSON.stringify(config, null, 2)`；
- “重新获取配置”按钮，运行中禁用并显示进度；
- 最近错误提示；
- MCP 服务器列表与连接状态（连接中/已连接+工具数/失败等）。

客户端每 3 秒轮询一次 `GET /state`（页面挂载期间），以覆盖首次后台生成和 MCP 连接状态变化；卸载时清除定时器。样式只使用 `--dsw-alias-*` 主题 token，文本走 `ctx.locale` 字典。

### 问题与解决办法

| 问题 | 处理 |
|---|---|
| 首次生成失败后每次启用都重试，违背“只获取一次” | 失败也写入状态文件（`config: null` + `lastError`）；只有状态文件缺失/损坏才自动尝试一次 |
| 用户删除状态文件后想恢复 | 视为首次安装，自动生成一次；UI 显示状态文件路径，README 说明删除即可强制重取 |
| 并发刷新 | 单个 `refreshPromise` 共享；UI 按钮在 `refreshing` 时禁用 |
| 刷新后新配置无有效服务器 | 保留旧配置与旧注册，仅记录 `lastError`；用户可修正 Wolfram 环境后重试 |
| 刷新改变配置导致工具短暂消失 | 只有 JSON 不等价才重注册；即使重注册，`mcpManager` 会先卸载旧实例再挂载新实例 |
| 状态文件写入失败 | 内存状态仍可用，UI 标记 `persisted: false` 并提示路径/错误；不静默 |
| 设置页请求未授权 | Host 路由用 `ctx.connection.admit` 限制 owner；非 owner 返回 401/403 |
| 禁用/卸载后状态文件残留 | 有意保留，保证重新启用时不重新获取；README 说明完整清理路径 |
| 设置页轮询在关闭后泄漏 | 组件卸载时清除 interval；请求带取消标记，忽略过期响应 |
| 首次后台生成期间用户打开设置页 | 快照带 `refreshing: true`，页面轮询到完成，不会误显示“无配置” |

### 实施记录（阶段二）

#### 实际文件结构

```text
index.js                 Host 入口：注册 API 路由与生命周期 effect
client.js                Client 入口：settings.section + settings.section.icon
lib/constants.js         id、API 前缀、状态路径、超时预算、生成表达式
lib/paths.js             $DSH_HOME / 状态文件 / 全局 skills 路径
lib/detect.js            wolframscript、Wolfram app、可执行文件检测
lib/wolfram.js           生成命令、输出解析、DSH 注册项转换、进程超时/进程组终止
lib/state.js             状态读写、原子写入、schema 归一化
lib/skills.js            Skills 复制/标记/token 作用域清理
lib/http.js              sendJson、owner 校验、API 路径解析
lib/runtime.js           持久化状态、MCP 注册、刷新串行化、API 快照、生命周期
scripts/host-contract.mjs 校验 id/inject/sample 转换
test/*.test.mjs          22 个单元/集成测试
src/Skills/              四个 Wolfram skill 源
src/wolframlanguage_mcp.json 测试夹具（运行时不用）
```

#### 实际 API 契约

`GET /dsh-wolfram-mcp/api/state` 返回：

```json
{
  "ok": true,
  "result": {
    "schemaVersion": 1,
    "version": "0.1.0",
    "config": { "mcpServers": {} },
    "fetchedAt": "ISO",
    "lastAttemptAt": "ISO",
    "lastSource": "initial",
    "lastError": null,
    "wolframscript": "/usr/local/bin/wolframscript",
    "wolframApp": "/Applications/Wolfram.app",
    "refreshing": false,
    "persisted": true,
    "statePath": "/Users/<user>/.dsh/dsh-wolfram-mcp/state.json",
    "skills": { "root": "...", "installed": [], "skipped": [], "error": null },
    "registrationErrors": [],
    "mcpServers": [{ "name": "WolframLanguage", "status": { "state": "connected", "toolCount": 7 } }],
    "lastRegisteredAt": "ISO"
  }
}
```

`POST /dsh-wolfram-mcp/api/refresh` 无请求体，等待一次生成完成后返回同一快照；生成失败时 HTTP 仍为 200，失败原因放在 `result.lastError`，旧 `config` 与旧注册保留。两个端点都要求 `ctx.connection.admit(req)` 的 owner principal，否则 401/403。

#### 与阶段一预期的差异

- 阶段一计划“不提供 Config/UI”；按用户本轮要求增加 Settings 页面与持久化状态。仍不引入插件 `Config` 字段（设置页是自定义 UI，不是 Config 表单），因此没有新增 `@deepseek-ai/schemastery` 依赖。
- 阶段一计划每次启用都从 kernel 生成；实际改为“状态文件缺失时首次生成，之后只读取”，并增加手动刷新。这也解决了每次启动等待约 25 秒的问题。
- Host ↔ Client 通道采用 `ctx.webServer.register` + `ctx.connection.admit`（`dsh-session-deleater` 已验证的本地插件模式），没有新增 Typert Remote 定义。
- Settings 页面用 `settings.section` + 同 id 的 `settings.section.icon`，页面文本走 `ctx.locale`，样式只用 `--dsw-alias-*` token。
- 状态文件命名 `$DSH_HOME/dsh-wolfram-mcp/state.json`；Skills 标记 `.dsh-wolfram-mcp.json` 含每次启用的 `token`，避免热重载时旧实例误删新副本。

#### 验证结果

- `npm test`：22 个测试全部通过（解析/转换、状态原子读写、Skills 复制/冲突/清理、安装检测、运行时注册与 API owner 校验）。
- `npm run build`：布局、依赖、清单、解析、测试、Host contract 探针全部通过。
- `plugin_manager install_bundle`：`application: applied`，profile 记录为 `link:/Users/hanluica/Documents/deepseek-harness/local-plugins/dsh-wolfram-mcp`。
- 首次激活后 `~/.dsh/dsh-wolfram-mcp/state.json` 已生成，`lastSource: initial`、`lastError: null`，命令为 `/Applications/Wolfram.app/Contents/MacOS/wolfram`，env 与示例 JSON 一致。
- 四个 skill 已复制到 `~/.dsh/skills/` 并带本插件标记；DSH 的 skill catalog 已出现 `wolfram-language`、`wolfram-notebooks`、`wolfram-paclets`、`wolfram-debugging`。
- `Slots.listSubTree({ root: 'settings.section' })` 显示 `id: wolfram-mcp`、`order: 22`、`active: true`。
- 禁用/重新启用已实测：
  - 禁用（`plugin_manager set_plugin`，entry `include:dsh-wolfram-mcp`，`application: applied`）后，DSH skill catalog 中的四个 Wolfram skill 立即消失；`~/.dsh/skills/` 变为空目录；Wolfram MCP 进程退出；`settings.section` 中的 `wolfram-mcp` 条目消失。
  - 状态文件 `~/.dsh/dsh-wolfram-mcp/state.json` 保留，`fetchedAt` 与 `lastAttemptAt` 均未改变。
  - 重新启用后，四个 skill 以新 token 重新复制并重新出现在 skill catalog；`wolfram-mcp` 设置页重新 active；Wolfram MCP 进程用持久化配置重新启动；状态文件的 `fetchedAt`/`lastAttemptAt` 保持 `2026-11-18T11:47:07Z` 不变，确认**没有自动重新获取配置**。
- `settings.section.icon` 中 `id: wolfram-mcp` 的图标注册也处于 active。
- MCP 服务器进程已启动（`/Applications/Wolfram.app/Contents/MacOS/wolfram -run …`）。首次启动下载 Chatbook 向量数据库约 10 分钟；下载完成后 mcp-client 成功连接，工具列表出现 `mcp__WolframLanguage__CodeInspector`、`ReadNotebook`、`SymbolDefinition`、`TestReport`、`WolframLanguageContext`、`WolframLanguageEvaluator`、`WriteNotebook`。
- 实际调用 `mcp__WolframLanguage__WolframLanguageEvaluator` 执行 `1 + 1` 返回 `Out[1]= 2`，确认 MCP 工具可执行，而非仅注册。
- 禁用/重启用中断了第一次下载，第二次启动继续下载；下载完成后连接成功，未影响持久化配置。
- `Config.listConfigs` 显示该 entry 的 `status: absent`，含义是本插件没有 Config schema；entry 本身已挂载（state/skills/注册均已发生）。

#### 已知运行时事项

- 本机首次 Wolfram MCP 启动需要下载 Chatbook 向量数据库（下载完成后目录约 460 MB），耗时约 10 分钟；注册项设置 `startupTimeoutMs: 600000` 处于临界，实际观察到下载完成后 mcp-client 重连并成功连接。文件已缓存，后续启动应显著加快；若其他慢网络机器频繁触发重连，可把 `MCP_SERVER_STARTUP_TIMEOUT_MS` 调到 20 分钟。
- 若运行时验证必须重启 DSH，按 `AGENTS.md` 4.2 处理；本轮已通过 live profile 安装并观察到 Host/Client 两侧生效。
- 禁用/重新启用仍需实测确认 MCP 工具撤除、Skills 撤除、状态文件保留且不重新生成；将在首次连接完成后补做。


# 初始化阶段常驻 Toast 通知

## 2026-11-18 扫描、获取配置与首次 MCP 下载期间的常驻提示

### 目的与范围

在插件安装并启用后的以下长耗时阶段，向用户显示一条**常驻 Toast**：

1. 自动扫描 Wolfram 安装、运行 `wolframscript` 并获取 MCP 配置；
2. 首次注册 MCP 服务器后，Wolfram MCP 进程下载/加载 Chatbook 向量数据库等数据的阶段。

Toast 在阶段进行期间一直显示，不做自动消失；当 Host 确认 MCP 连接成功（首次连接完成）后，由 Client 主动撤销。失败时不保留一条误导性的“正在加载”提示，改为不显示（详细错误留在 Settings → Wolfram MCP 页面）。

范围仅限本插件的初始化提示；不改变 DSH 其他通知，不增加全局通知服务，不引入新的 npm 依赖。

### 可行性

#### DSH 内置通知能力调查

- **没有通用的全局 Toast 服务**：`cordis_inspect_query` 的 Client `Service.listService` 只返回 `layout`、`locale`、`sessions`、`slots`、`theme`、`timer`、`uiWorkspace`、`workspaces`，不存在 `toast`/`notification`/`notice` 服务。
- **`workspace.toast` 不是通用入口**：它是 keyed 槽位，key 域固定为 Workspace 的 `RowToastState['kind']`（`archivedNotOpenable`、`createFailed`、`pinned` 等），由 Workspace 自己的状态驱动；第三方不能用它注入自定义通知。
- **内置 Toast 是各功能自建的局部状态**：`dsh-client-ui-open-in-app` 的 `open-in-app.toast`、`dsh-client-ui-schedule` 的 `schedule.delete-toast` 都各自创建 store，再注册到 `shell.overlay`；渲染使用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Toast` 组件。该组件接受 `holdMs` 与 `onDone`，是定时消失的瞬态展示，没有“常驻直到外部条件满足”的契约。
- **`dsh-doc` 明确禁止直接 require 内部 Client 包**（包括 `dsh-client-ui-primitives`）：`references/practices.md` 要求复制其 markup/CSS 并写自己的控件；因此不能把内部 `Toast` 当稳定 API 使用。
- **受支持的通用扩展点是 `shell.overlay`**：`Slots.listSubTree({ root: 'shell.overlay' })` 的 catalog 明确写着该槽位“Deliberately generic and unowned by any feature: a badge, a toast stack or a status pill all belong here… additive seat for a frame-wide surface of your own”，且 registration 只需 `id`/`order`/`label`。现有 `open-in-app.toast`、`schedule.delete-toast`、`workspace.row-toast` 都注册在这里。
- **Host 侧状态事件可用**：`Event.listEvents` 确认 `mcp-manager/status(name, status)` 是 parallel 事件，`status.state === 'connected'` 表示 MCP 已连接；现有 `/dsh-wolfram-mcp/api/state` 已能返回 MCP 状态。

结论：DSH 没有“常驻 Toast 服务”，但 `shell.overlay` 是官方支持的框架级浮层入口。实现一个自有的、无定时器、由 Host 阶段状态驱动的 overlay Toast，即可满足需求；不需要也不应该依赖内部 `Toast` 组件。

### 核心进路

**Host：新增首次连接标记与阶段字段**

- `state.json` 增加 `mcpReadyAt`（ISO 字符串或 null），表示本插件首次确认 MCP 连接成功的时间；旧状态文件缺少该字段时归一化为 null。
- `lib/runtime.js`：
  - `start()` 在应用持久化配置前注册 `ctx.on('mcp-manager/status', (name, status) => …)`；当 `name` 属于本插件注册、且 `status.state === 'connected'` 时，写入 `mcpReadyAt` 并持久化。
  - `snapshot()` 在 `mcpServers` 中若发现 `connected`，也补写 `mcpReadyAt`，覆盖事件早于监听器/漏发的情况。
  - `snapshot()` 增加 `phase`：
    - `fetching`：`refreshing` 为真（扫描/生成配置）；
    - `mcp-starting`：`mcpReadyAt` 为 null，且 MCP 状态为 `connecting`/`reconnecting`/`waiting-credentials`，或注册已存在但状态尚未发布；
    - `error`：`mcpReadyAt` 为 null，且存在 `lastError`、`failed` 状态或注册错误；
    - `ready`：`mcpReadyAt` 非 null；
    - `idle`：尚未开始初始化。
  - `snapshot()` 额外返回 `mcpReadyAt` 与 `phase`。
- 不改变现有 `refreshing`、`lastError`、MCP 状态的语义；设置页仍可用这些字段。

**Client：`shell.overlay` 常驻 Toast**

- 在 `client.js` 注册 `id: 'wolfram-mcp.status-toast'` 的 `shell.overlay` 条目（`order: 100`），组件每 2 秒读取一次 `/state`。
- 组件不设置任何 dismiss 定时器：
  - `phase === 'fetching'` → 显示“正在检测 Wolfram 安装并获取 MCP 配置，首次可能需要一些时间…”；
  - `phase === 'mcp-starting'` → 显示“Wolfram MCP 首次启动，正在下载/加载数据，可能需要数分钟。完成后此提示会自动消失。”；
  - `phase === 'ready'` / `'error'` / `'idle'` → 返回 null，Toast 消失。
- 初次安装时两个阶段连续显示同一条 Toast，文本从扫描切换到首次启动；MCP 连接成功后由阶段变化主动撤销。
- 失败时隐藏加载 Toast（不显示永久“正在加载”），详细错误继续由 Settings 页面展示。
- Toast 样式按 `dsh-doc` 的 UI 规则自建，使用 `--dsw-alias-toast-bg`、`--dsw-alias-border-l1`、`--dsw-alias-brand-primary` 等主题 token；`pointer-events: none`，不阻塞页面；`role="status"`、`aria-live="polite"`。文本走现有 `ctx.locale` 字典。
- 刷新浏览器页面时 overlay 重新挂载并轮询；若 Host 仍处于 `fetching`/`mcp-starting`，Toast 会重新出现，符合“常驻到完成”的语义。

**备选与不采用**

- **复用 `workspace.toast`**：key 域固定为 Workspace 通知，无法注入本插件状态；不采用。
- **直接 require `Toast` primitive**：`dsh-doc` 明确禁止；内部组件的 `holdMs`/`onDone` 是瞬态契约，也不能表达“常驻直到 Host 确认”；不采用。
- **Electron 原生通知**：不在页面内、受系统权限影响，且不能表达“完成前常驻”；不采用。
- **新增全局通知服务**：超出本插件范围，会与 DSH 现有 UI 契约冲突；不采用。

### 问题与解决办法

| 问题 | 处理 |
|---|---|
| 首次连接事件早于监听器注册 | `start()` 在 `applyConfig` 前注册监听；`snapshot()` 另外检查 `connected` 并补写 `mcpReadyAt` |
| Host 已有连接但事件漏发 | 每次 `/state` 快照检查 `mcpManager.list()` 的 `connected`，补写并持久化 |
| 首次启动失败，Toast 永久显示“正在加载” | `phase` 变 `error` 时 overlay 返回 null；详细错误在设置页展示 |
| 浏览器刷新/重新打开页面 | overlay 挂载后重新轮询 `/state`，按当前 phase 恢复显示或隐藏 |
| 与设置页重复轮询 | 2 秒一次的本机 `/state` 请求成本很低；保持设置页现有 3 秒轮询，不重构其数据流，降低回归风险 |
| Toast 遮挡交互 | `pointer-events: none`；仅显示信息，不提供按钮 |
| 视觉与内置 Toast 不一致 | 复制现有 toast 的视觉语言（底部居中、圆角、细边框、主题 token）；不 require 内部组件 |
| 首次安装已完成但用户后打开页面 | Host 已持久化 `mcpReadyAt`，`phase: ready`，不显示 Toast |
| 升级后旧状态文件没有 `mcpReadyAt` | `normalizeState` 归一化为 null；下一次成功连接后补写 |
| 首次下载耗时超过 `startupTimeoutMs` | mcp-client 的重连会继续；`mcpReadyAt` 只在真正 connected 后写入，Toast 保持到成功或失败 |

### 实施与验证计划

1. Host：扩展状态 schema、事件监听、phase 计算；补充单元/集成测试（connected → `mcpReadyAt`、connecting → `mcp-starting`、refreshing → `fetching`、失败 → `error`）。
2. Client：新增 overlay 组件、样式、字典键；`npm run build` 检查解析与清单。
3. 重新启用插件让 link 代码生效；确认：
   - 首次阶段出现常驻 Toast（可用删除 `state.json` 后重新启用模拟首次安装）；
   - MCP 连接成功后 Toast 自动消失；
   - 浏览器刷新后按当前 phase 恢复；
   - Settings 页面与已有 MCP 功能不回归。
4. 更新 README 与版本（0.1.1），提交本地 Git。

### 实施记录（阶段二）

- 版本提升到 `0.1.1`（`package.json` 与 `PLUGIN_VERSION`）。
- Host：
  - `state.json` 新增 `mcpReadyAt`；旧状态文件缺少该字段时归一化为 null。
  - `lib/runtime.js` 在 `start()` 中于应用配置前注册 `ctx.on('mcp-manager/status', …)`，首次 `connected` 时写入 `mcpReadyAt` 并持久化；`snapshot()` 也会检查 `mcpManager.list()` 的 `connected` 状态补写，覆盖漏发事件。
  - `snapshot()` 返回 `mcpReadyAt` 与 `phase`：`fetching` / `mcp-starting` / `error` / `ready` / `idle`。
- Client：
  - `client.js` 新增 `WolframMcpStatusToast`，注册到 `shell.overlay`，`id: wolfram-mcp.status-toast`、`order: 100`，每 2 秒读取 `/state`。
  - 无 `setTimeout`/自动消失逻辑；仅当 `phase` 为 `fetching` 或 `mcp-starting` 时渲染，阶段变化后返回 null。
  - Toast 使用底部居中圆角浮层、主题 token、旋转 spinner；`pointer-events: none`，`role="status"` 与 `aria-live="polite"`。
  - 字典新增 `toast.scanning` 与 `toast.mcpStarting` 的中英文文本。
- 测试：24 个测试全部通过。新增覆盖：`mcp-starting → connected` 事件将 `mcpReadyAt` 置位、`refreshing` 时 `phase=fetching`、失败状态 `phase=error`。
- `npm run build` 全部检查通过。
- 重新启用 live 插件后：
  - `Slots.listSubTree({ root: 'shell.overlay' })` 显示 `wolfram-mcp.status-toast`、`order: 100`、`active: true`。
  - 重新连接后 `state.json` 写入 `mcpReadyAt: "2026-11-18T12:20:07.478Z"`；`list_mcp_resources` 返回 `WolframLanguage` 且 MCP 工具列表恢复。
  - 首次启动 Toast 在本次重启用中会出现一个短暂阶段（数据已缓存）；完整的长阶段提示需要删除 `state.json` 或全新安装后观察。
- 限制：没有浏览器截图工具，Toast 的像素级位置/视觉未由我直接验收；Slot 注册、phase 状态与构建检查已确认。可请用户在全新安装或手动刷新时观察。
