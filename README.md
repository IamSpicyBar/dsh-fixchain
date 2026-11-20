# dsh-fixchain · Studio 0.2.1-studio.1

这是 RSI Studio 的可运行离线适配 fork，上游为 hxy450/dsh-fixchain@debe72eb。制卡与归并复用公开 hxy450/migloop@c72c0db 的 skills 0.10.10，**无需 a2h-memory checkout 或 feat/dsh-adapter 分支**。

0.2.1 将离线制备／交付检查脚本收回本插件，消除对 Memory 评测插件、控制台及 pluginRoot 路径的反向依赖。公开调用入口仍为 `./offline` 和 `memory_distill prepare/check`。能力声明见 capabilities.json：可作为诊断和 Memory 候选优化步骤；目前验证领域为迁移返修，PPT 专用诊断尚未验收，也不直接改写 Skill 候选。

可以按 [Memory RSI 控制台](https://github.com/IamSpicyBar/dsh-memory-eval) 的 README 下载发布包并执行 setup；新版会生成 distillation-runtime.json。也可独立提供以下最小 runtime，仅需 Python、公开 MigLoop 源码及已构建 skills，完全不需要评测仓库或 Studio UI：

```json
{"schemaVersion":"hmbot.rsi.distillation-runtime/1","python":"/absolute/venv/bin/python","skills":"/absolute/built-skills","migloop":{"directory":"/absolute/public-migloop"}}
```

将该文件通过 HMBOT_MEMORY_RUNTIME 指向本插件，随后安装到独立 DSH profile。旧 hmbot.memory.runtime/1 仍可读取，新的执行路径不使用其中的 evaluation、pluginRoot 等字段。

    export HMBOT_MEMORY_RUNTIME="$HOME/.hmbot-memory-rsi/distillation-runtime.json"
    dsh plugin --profile YOUR_PROFILE add /absolute/path/to/this/repo

离线入口：

    /fixchain prepare --offline "/absolute/offline-config.json" --out "/new/run"
    /fixchain cards "/new/run"
    /fixchain check "/new/run"

offline-config.json 明确包含 materials 绝对路径、format（claude / codex / deveco / dsh / a2h-export/4 / native-pool）、app、可选 baseStore、scope、maxIssues。DSH 原始 generation 另显式指定 sessions 路径数组；不猜选最近会话。可选 checkpointRepository / generationRef / finalRef 保留历史 Git 对象与修复 diff。飞轮导出必须先由控制台校验 manifest 及所有 run/epoch 后交入。

提供 DSH 工具 memory_distill（prepare/check）与可直接 import 的 ./offline API。控制台与原生命令共用同一入口；不另实现一套制卡算法。交付检查要求 completed、来源一致的有效卡、所有派工闭合、精确 store revision 以及完整阅读包摘要。partial、缺片、缺 completion 均不能当成已完成优化。模型制卡会产生费用，prepare/check 不调用模型。

下面保留上游 0.1.0 的原始说明；其中 a2h-memory 专用 legacy 入口仅用于已有该分支的旧环境，Studio 新入口使用上述独立 MigLoop 运行包。

---

# dsh-fixchain

DeepSeek Harness（dsh）插件：对在 dsh 里做的迁移和返修做返修链路归因（→ 情景卡 → 经验库新版本），也能只看轨迹不分析。

分析全部用 a2h-memory 自带的工具链：`distill/distill.py`（prepare / check）、`migloop/src/migloop/inquiry`（索引与查看界面）、`migloop/skills`（triage → 制卡 → 归并）。插件只做三件事：通过 dsh 的 `sessionPersistence` 找到会话日志；启动这些 Python 进程；在 dsh 里起一个 headless 会话跑制卡。

## 要求

| 项 | 版本 |
|---|---|
| dsh | `>=0.2.2-rc.1 <0.3.0`（在 0.2.2-rc.1 上验证；会话格式 v4） |
| Node.js / pnpm | 随 dsh；`dsh plugin` 用 pnpm 装插件 |
| a2h-memory | 带 dsh 支持的版本（分支 `feat/dsh-adapter`），在配置里给出路径 |
| Python | 3.10+，装有 PyYAML 6.0.3（distill 打 skill 包时用）；不需要 numpy 等检索依赖 |
| 工程 | 迁移目标是 git 仓库：迁移结束的提交打标签 `execute-end`，返修一处一个提交 |
| 制卡模型 | 制卡会话用 worker profile（默认 shipped `headless`）的模型和凭据，默认 `deepseek-flash` + `DEEPSEEK_API_KEY` |

## 安装

```sh
dsh plugin --profile web add /path/to/dsh-fixchain
```

在该 profile 的 `cordis.patch.yml` 里指向 a2h-memory（覆盖会替换整段 config）：

```yaml
- id: dsh-fixchain
  config:
    a2hMemory: /path/to/a2h-memory
    python: ''              # 空 = DSH_FIXCHAIN_PYTHON，否则 Windows `py -3`，其他 python3
    runsDir: ''             # 空 = $DSH_HOME/fixchain-runs
    workerProfile: headless
    workerModel: deepseek-flash   # 记进 analysis-runtime.json，卡片的分析模型
    dshCommand: []          # 空 = 用当前进程的 dsh 启动器起制卡会话
```

## 命令

| 输入 | 结果 |
|---|---|
| `/fixchain view <会话> [<会话>…]` | 把会话（含子代理）冻结成 `dsh-events/1`，建 inquiry 索引，起本机查看界面：文件 × agent 的时间证据树。只浏览，不做归因 |
| `/fixchain stop` | 关掉查看界面 |
| `/fixchain prepare --migration <id> --repair <id> [--repair <id>] [--project DIR] [--source DIR] [--out DIR] [--app NAME] [--base NAME \| --base-store DIR --base-memory DIR]` | `distill.py prepare --platform dsh --worker-host dsh`：材料池、git 检查点、证据、起点库、skills、job.json、CLAUDE.md。`--project` 默认是迁移会话的 cwd |
| `/fixchain cards <run 目录> [--resume]` | 在 run 目录里起一个 headless dsh 会话，按 CLAUDE.md / job.json 走 migloop-session-to-memory；结束后自动跑 `distill.py check`，结果写进 `dsh-worker-state.json`。立即返回 |
| `/fixchain status <run 目录>` | 制卡会话状态、completion、最近一次检查 |
| `/fixchain check <run 目录>` | 只跑 `distill.py check` |

会话 id 可以是 `session-<uuid>` 或 uuid 前缀。命令本身不花 token；只有 `cards` 起的制卡会话调用模型。

制卡会话的工作区就是 run 目录（dsh 的 workspace-write 沙箱只放行这里的写入），工程、安卓源码和 skills 只读。Windows 上 skill 包是在 Python 临时目录里打的，带一份只给属主的 ACL，dsh 沙箱读不了；`cards` 启动前会把 run 下的 `skills/` 改回继承 run 目录的权限（`icacls skills /reset /T`）。

## 冒烟测试

```sh
DSH_HOME=... PATH=<pnpm 所在目录>:$PATH \
node scripts/smoke.mjs --dsh <dsh 的 bin.js 或 dsh> --a2h-memory <checkout> \
  --migration <迁移会话 id> --repair <返修会话 id> --source <安卓源码目录> [--with-cards]
```

插件装进临时 profile（从 `sdk` 模板复制），用 profile 补丁配置，启动后由只用于测试的 driver 插件（`--patch` 挂入）在 dsh 进程里经人类命令注册表执行：`help`、`view` + 页面 200、`stop`、`prepare`（核 job.json、冻结的三份材料、边界证据）、`status`、`check`（交付前报缺 completion）。起点库用 a2h-memory 的 `tests/fixtures/library`，不联网。`--with-cards` 再跑一次真实制卡并核 `distill.py check`，这一步调用模型、要凭据。

## 限制

- 只认 dsh 会话格式 v4。
- 制卡质量取决于 worker 模型；用 deepseek-flash 跑出的卡与 Claude Code 输入走同一套 skill、同一个 pack 检查器和同一个 `distill.py check`，但没有和 Opus 制卡做过质量对比。
- `distill.py run`（Claude Code 宿主）不变；dsh 宿主由本插件起会话、管续跑。
- dsh 会话日志不记录 dsh 版本号，卡片里的客户端版本保持未知。

## General task intake (experimental)

Set `domain: "general-task"` in offline preparation config to use a real task trace instead of migration assumptions. Default remains `migration-repair`. Native DSH `session.v4.jsonl[.zstd]` is supported via the public lossless reader; explicitly select the actual generation. No event is reconstructed from prose. General jobs use task/Skill requirements as authority, omit the migration-specific holdout app, and preserve legacy lineage names. Cards still require actual deviation and repair evidence; success-only traces must not be forced into failure cards. Domain/PPT quality verification is separate from input-format compatibility.
