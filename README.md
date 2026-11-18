<p align="center">
  <img src="assets/icon-180.png" width="96" alt="Background tasks icon">
</p>

# 后台任务台 · Background Tasks

**中文** · [English](#english)

DSH 把 dev server、构建、长脚本放到后台跑的时候，这些后台任务只按**当前会话**展示：
换个会话，另一处还在跑的 `pnpm dev` 就看不见了。
**后台任务台**把它们收进一页：所有会话的后台任务都在这里，并能以「工作区 / 会话 / 脚本」
三种视角看同一批任务。

## 三个视角

| 视角 | 分组的键 | 回答的问题 |
| --- | --- | --- |
| 工作区 | 任务所属工作区（路径） | 这个项目里还有什么在跑 |
| 会话 | 发起任务的会话 | 这个会话留了几个后台活 |
| 脚本 | 从命令行提炼的脚本名（`cd … && pnpm dev --port 3000` → `pnpm dev`） | `pnpm dev` 一共起了几份 |

切换是即时的——同一份数据换一种分组，不重新读。选中的视角记在浏览器本地，刷新后还在。

## 能做什么

- **一页看全**：不再只看得见当前会话。所有会话（含子代理会话）的任务都在这里，附带
  「谁发起的、在哪个项目、跑的是哪条命令、跑了多久、吐了多少输出」。
- **看输出尾部**：读的是任务输出环形缓冲的最后一段，通过非消耗读接口拿，**不影响模型侧
  `job_output` 的游标**，模型看到的输出不会被插件吃掉。
- **停止任务**：单条停止有确认框；也有「全部停止」，逐个停并说明影响范围。两者都不碰 DSH
  进程本身，也不碰任何不由 DSH 任务系统管理的进程。
- **跳到发起它的会话**：每行可一键打开对应会话（宿主提供 `uiWorkspace` 服务时）。
- **只看运行中**：隐藏已结束的任务；顶部一排统计给出运行中 / 总数 / 会话数 / 工作区数 / 脚本数。
- **自动刷新**：每 3 秒刷新一次，页面切到后台就停。

## 安装

插件市场（[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)）收录后，
可在 **插件 → 市场** 里一键安装。

收录之前，任选一种：

- **预构建包**：从 [Releases](https://github.com/zihangii/dsh-job-desk/releases/latest) 下载
  `dsh-job-desk-<version>.tgz`，在 **插件 → 添加插件** 里选它。
- **本地目录**：克隆仓库后，在 **插件 → 添加插件** 里选择该目录。
- **命令行**：`dsh plugin add <tarball 的 https 地址>`，profile 不是 `web` 时加 `--profile <名字>`。

装好后侧栏出现「后台任务台」入口，点开即用；不需要重启。

## 它怎么知道这些

Host 半边读 DSH 自己的后台任务注册表 `ctx.jobs`，只读：

- 逐个会话取各自的任务清单，再并上不属于任何会话的任务，按 id 去重；
- 会话标题来自 `sessionTitle`，工作目录来自会话 header，工作区归属来自工作区注册表
  （工作区记着自己名下的会话）；
- 脚本名从命令行提炼，完整命令行原样展示。

浏览器半边通过同源接口 `/job-desk/api` 取数据，接口只接受本机页面调用。

## 限制

- 后台任务是**进程内**的：DSH 重启，它们就没了，任务台也自然清空。
- 只列 DSH 的后台任务；用 `nohup` 之类甩出去、脱离任务注册表的进程不在其中。
- 输出是环形缓冲的最后一段；更早的输出被丢弃时会明确提示。
- 「打开会话」需要当前 DSH 提供 `uiWorkspace` 服务，没有时这个按钮不出现，其它功能照常。

## 开发

没有构建步骤：`index.js` 是 Host 半边（Cordis 插件），`client.js` 是浏览器半边
（`window.__ModuleLoader__` 工厂），`cordis.patch.yml` 插入插件行。改完把目录重新装一次即可。

```
index.js          Host 半边：汇总任务、停止、输出尾部，/job-desk/api
client.js         浏览器半边：侧栏入口 + 主区域任务台
cordis.patch.yml  插入 job-desk 这一行
locale/*.json     插件卡片的中英标题与描述
icon.svg          插件图标（矢量）
assets/            市场卡片用的 180px 位图
```

## 许可

MIT

---

<a id="english"></a>
## English

DSH shows background tasks only inside the session that started them: switch sessions and the
`pnpm dev` running in the other one disappears from view. **Background tasks** puts every session's
jobs on one page and lets you read the same set through three groupings — by workspace, by session,
or by script — then inspect a job's output tail, stop it, or jump to the session that started it.

- **One page, every session**: what is running, in which project, with which command, for how long,
  and how much output it produced.
- **Output tail without stealing it**: the plugin reads the job's output ring through the
  non-consuming read, so the model's own `job_output` cursor is untouched.
- **Stop, individually or all at once**, with a confirmation that spells out the scope. DSH itself
  and processes outside its job registry are never touched.
- **Jump to the owning session**, when the host provides `uiWorkspace`.

Install: once listed in the plugin market, install it with one click; before that, use the
prebuilt `.tgz` from Releases, or add the cloned directory under **Plugins → Add plugin**.
No restart is needed — the sidebar gains a “后台任务台 / Background tasks” entry.

The Host half reads `ctx.jobs` read-only and merges per-session rosters with the unowned jobs;
session titles come from `sessionTitle`, working directories from the session header, and workspace
ownership from the workspace registry. The browser half reads one same-origin route,
`/job-desk/api`, which only accepts requests from this machine.

Limitations: background jobs live in the process, so they disappear with a DSH restart; the plugin
lists DSH jobs only (not `nohup`-style processes outside the registry); output is the tail of a
bounded ring buffer and says so when earlier output was evicted.

MIT licensed.
