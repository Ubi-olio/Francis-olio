---
layout: post
title: "mini-SWE-agent 学习笔记 07：运行摘要与批量任务"
date: 2026-11-05 12:00:00
slug: mini-swe-agent-07-batch
tags:
  - mini-SWE-agent
  - Python
  - AI Agent
categories:
  - 技术学习
---

整理本次 mini-swe-agent 2.4.6 的源码阅读与实验记录。

<!-- more -->

## 从单次运行增加摘要功能

在批量运行之前，我先给 Agent 增加了 `get_summary()`。Agent 已经持有消息历史、调用计数和结束消息，适合在这里计算摘要。

```python
{
    "steps": self.n_calls,
    "failed_commands": failed_commands,
    "exit_reason": last_message.get("extra", {}).get("exit_status", ""),
}
```

失败数遍历工具执行记录中的非零返回码，排除 `action was not executed` 的占位消息。超时产生的 -1 会计入，但完成信号后的占位 -1 不计入；相同数值不一定有相同含义。

`serialize()` 把对象当前状态整理成可保存的字典，在 `info` 中增加 `summary`，原来的 `model_stats` 仍记录费用和调用统计。运行入口在 `try/finally` 中打印摘要；finally 不会自动吞掉异常，也不覆盖创建对象之前的错误。

成功与故意失败两类运行都核对了摘要。命令返回 2，而 Agent 按要求提交时，结束原因仍可以是 Submitted。其他状态包括 LimitsExceeded、TimeExceeded、RepeatedFormatError 和普通异常类型名。

[核心功能提交 99b1836c](https://github.com/Ubi-olio/mini-swe-agent/commit/99b1836c) 保存了这次改动。下面继续记录如何复用单任务能力，写出外层批量入口。

日期：2026-11-04

## 1. 今天完成了什么

在上一阶段“单次运行摘要”的基础上，增加一个本地批量入口，依次运行多个任务。每个任务有独立工作目录和原始轨迹，每完成一项就更新汇总。

**汇总用于快速比较，轨迹用于追查过程，任务是否完成还要对照验收条件。**

- `批量入口 batch.py`
- `任务清单 tasks.json`
- `任务原始材料 fixtures`
- 本次完整汇总（本地记录）

## 2. 为什么写一个新的运行入口

Agent 已经会运行一个任务、保存轨迹和计算摘要。批量入口负责安排多个独立运行，无需重新实现 Agent 循环。

```text
batch.py 读取任务清单
  → 创建本轮运行目录
  → 为当前任务创建工作目录，复制材料
  → 启动一个 mini 子进程，等待它结束
  → 读取该任务的 trajectory.json
  → 提取 info.summary，更新总汇总
  → 继续下一个任务
```

当前是顺序运行，不是并行运行。

## 3. 任务清单的结构

每项任务包含以下字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 唯一标识，同时作为任务目录名 |
| `task` | 传给模型的任务文字 |
| `template` | 可选；相对于任务清单所在目录的原始材料路径 |
| `acceptance` | 可选；供验收时对照的条件 |

`acceptance` 被保存到汇总中；当前脚本不会自动执行这些验收条件。

读取与检查发生在 `batch.py 第 11 行`：

```python
tasks_file = tasks_file.resolve()
tasks = json.loads(tasks_file.read_text(encoding="utf-8"))
```

`resolve()` 把路径转换为绝对路径。`read_text()` 读取文字，`json.loads()` 把 JSON 文字转换为 Python 列表和字典。

检查 id 是否重复时，`set` 会去掉重复值；去重后长度变小，就说明有重复任务 id。

当前使用自己编写的任务清单，id 应为简单目录名，例如 `sales-report`。脚本目前只检查重复，没有额外验证目录名。

## 4. 怎样避免覆盖文件

在 `第 18 行`，用时间戳创建本轮目录；随后每项任务创建自己的子目录。

```text
runs/
└── 20261104-211523-591784/
    ├── success/trajectory.json
    ├── failure/trajectory.json
    ├── sales-report/
    │   ├── orders.csv
    │   ├── sales_report.py
    │   ├── report.json
    │   └── trajectory.json
    ├── log-summary/…
    ├── fix-pagination/…
    └── summary.json
```

`Path` 的 `/` 用于拼接路径。`shutil.copytree()` 把原始材料复制到任务目录，让每次从相同材料开始。

`cwd=task_dir` 设置子进程工作目录，但不是文件访问隔离机制。模型执行的命令仍可能访问其他路径；本次销售报表任务就曾使用 `/tmp` 验证其他输入。

## 5. 怎样启动 mini 子进程

`第 33 行` 使用 `subprocess.run()`。

| 参数 | 含义 |
| --- | --- |
| `sys.executable` | 使用运行批量脚本的同一个 Python |
| `-m minisweagent.run.mini` | 从 Python 模块启动 mini |
| `-c mini.yaml` | 加载基础配置 |
| 第二个 `-c` | 加载共用 Kimi 模型配置和每任务 12 步限制 |
| `-o` | 指定当前任务的独立轨迹路径 |
| `-t` | 指定当前任务文字 |
| `-y` | 自动执行模型动作，不逐条询问 |
| `--exit-immediately` | 提交结束后不再询问新任务 |
| `cwd=task_dir` | 在当前任务目录启动 |
| `check=False` | 子进程返回非零时，不因此抛出异常，可继续下一项 |

`subprocess.run()` 会等当前子进程结束，再返回 `result`。所以读取 `result.returncode`、整理汇总的代码必须放在调用的右括号之后。

`check=False` 不表示所有异常都会忽略。例如启动进程本身失败、读取 JSON 失败，当前脚本仍可能中断。

## 6. 两种返回码不要混淆

| 记录 | 对应什么 |
| --- | --- |
| 工具消息中的 `returncode` | 模型提出的那一段命令的执行结果 |
| 汇总中的 `process_returncode` | 整个 mini 子进程的退出结果 |

模型执行 `sys.exit(2)`，工具返回 2；模型随后正常提交，mini 子进程可以返回 0。

因此，`process_returncode=0` 不代表每条命令成功，也不代表任务满足验收条件。

## 7. 汇总怎样生成，怎样追溯

`第 54 行开始`，为每个任务记录：

- 任务 id、任务文字和验收条件。
- mini 进程返回码。
- 相对于本轮目录的原始轨迹路径。
- 从轨迹中读取的 `info.summary`。
- 记录收集状态 `record_status`。

| record_status | 含义 |
| --- | --- |
| `collected` | 找到轨迹，并读到非空的摘要字段 |
| `missing_summary` | 有轨迹，但没有摘要或摘要为 null |
| `missing_trajectory` | 没有生成轨迹文件 |

这里的状态只描述记录是否收集成功，不是任务完成情况。

每完成一个任务，先把记录加入 `results`，再将整个列表写入 `summary.json`。`ensure_ascii=False` 使中文直接显示，`indent=2` 让 JSON 更容易阅读。

轨迹路径使用相对路径，例如 `sales-report/trajectory.json`。搬动整轮目录后，仍可根据汇总定位原始轨迹。汇总不替代原始轨迹，也不改写它。

## 8. 本次运行结果

本轮目录：`20261104-211523-591784`。

| 任务 | 步数 | 命令失败数 | 结束原因 |
| --- | ---: | ---: | --- |
| 成功命令（本地记录） | 2 | 0 | Submitted |
| 故意失败（本地记录） | 2 | 1 | Submitted |
| 销售报表（本地记录） | 4 | 0 | Submitted |
| 日志统计（本地记录） | 5 | 0 | Submitted |
| 分页修复（本地记录） | 5 | 0 | Submitted |

五项进程返回码均为 0，`record_status` 均为 `collected`。汇总摘要与各自轨迹中的摘要一致。

核对的任务结果：

- 销售报表：Notebook 数量 5、收入 62.50；Pen 数量 7、收入 8.40。
- 日志统计：INFO=3、WARNING=1、ERROR=2、invalid_lines=3。
- 分页修复：轨迹记录修复后 10 项测试通过。
- 原始 `orders.csv`、`app.log` 和 `test_pagination.py` 与准备材料一致。

以上不等同于全部边界条件都经过独立复验；本次批量功能的验收重点是记录汇总与追溯。

### 为什么分页测试失败过，命令失败数还是 0？

模型使用了类似命令：

```bash
python -m pytest -q 2>&1 | tail -60
```

pytest 失败，但最后的 `tail` 成功，整段管道默认返回 0。现有摘要只统计工具记录的非零返回码，所以没有统计成失败。

**“工具返回码为非零的命令数”不能完全代表“所有实际发生的测试失败数”。** 这是目前统计规则的局限，本次没有修改它。单条命令超时返回的 -1 会计入失败；`action was not executed` 的占位记录则排除。

## 9. 重新启动与中断

运行命令：

```bash
python /path/to/mini-swe-agent/practice/day11/batch.py \
  /path/to/mini-swe-agent/practice/day11/tasks.json
```

运行脚本会调用模型，按清单顺序自动执行任务。

当前没有暂停恢复、跳过已完成任务或断点续跑功能。中断后，已写入的文件保留；当前任务可能尚未加入汇总。mini 会处理 Ctrl+C，可能进入用户交互，因此中断行为不等同于立即退出所有进程。

重新启动会创建新的时间目录，从第一项重新开始。

## 10. 本次写代码遇到的问题

| 问题 | 原因与改法 |
| --- | --- |
| `tasks_filr` 与 `tasks_file` 不一致 | 变量名称必须完全一致，否则 NameError |
| `for task in task` | 应遍历整个列表 `tasks` |
| 循环顶格 | 函数内 4 空格，循环体内 8 空格 |
| 字符串参数之间漏逗号 | 相邻字符串可能被自动拼接，语法通过却参数错误 |
| 把 `record` 写进 `subprocess.run()` 括号内 | 先结束调用，再读取返回结果并汇总 |
| 仍逐条询问动作 | 需要给每个 mini 子进程传入 `-y` |

## 11. 修改功能时怎么定位

本次需求是“安排多个任务并收集结果”，所以改运行入口层。单任务 Agent 的循环和摘要计算继续复用。

以后要调整：

- 任务内容、输入材料或验收条件：修改 `tasks.json` 和 `fixtures/`。
- 批量顺序、目录或汇总字段：修改 `batch.py`。
- 单任务摘要的计算规则：修改 Agent 的 `get_summary()`。
- 命令执行或真实返回码收集方式：查看 Environment。

本次没有自动评分、并行运行、自动恢复或自动提交到 GitHub。这些是后续可以分别设计的功能。


---

{% post_link mini-swe-agent-index "系列目录" %} · {% post_link mini-swe-agent-06-failures "上一篇：区分环境、模型与任务问题" %} · {% post_link mini-swe-agent-08-evaluation "下一篇：建立八项任务的小型测评集" %}
