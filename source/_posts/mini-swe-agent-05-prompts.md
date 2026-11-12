---
layout: post
title: "mini-SWE-agent 学习笔记 05：只改一项提示词的对照实验"
date: 2026-11-05 12:00:00
slug: mini-swe-agent-05-prompts
tags:
  - mini-SWE-agent
  - Python
  - AI Agent
categories:
  - 技术学习
---

整理本次 mini-swe-agent 2.4.6 的源码阅读与实验记录。

<!-- more -->

日期：2026-10-26

## 1. 今天的目标

在相同任务与相同模型配置下，只修改一项提示词，比较行为、结果和消耗。

**重点：判断 Agent 实际执行了什么，要对照动作与工具返回，不能只看模型说自己完成了。**

实验文件：

- A 组轨迹（本地记录）
- B 组轨迹（本地记录）
- `B 组提示词配置`
- `共用模型配置`

## 2. 相同的任务

```text
执行一次命令 python -c "import sys; print(\"failure demo\"); sys.exit(2)"。
这是故意失败。观察输出和返回码后提交，不要修复或重试。
不要读取凭据或环境变量。
```

任务要求的结果本来就是失败。这里要验证的是：Agent 能否执行一次、正确观察失败，然后按要求结束。

### `-t` 是什么意思？

```bash
-t '执行一次命令……'
```

这是 `mini` 的任务参数，把引号中的文字作为任务交给模型。它本身不会直接执行文字里的 Python 命令。

流程为：任务文字 → 模型提出动作 → 用户确认（confirm 模式）→ Environment 执行 → 返回观察 → 模型决定下一步。

### Python 命令是什么意思？

```bash
python -c "import sys; print(\"failure demo\"); sys.exit(2)"
```

| 部分 | 含义 |
| --- | --- |
| `python -c "…"` | 直接执行引号内的 Python 代码，不需要创建 `.py` 文件 |
| `import sys` | 导入 Python 的 `sys` 模块 |
| `print("failure demo")` | 打印 `failure demo` |
| `sys.exit(2)` | 以返回码 2 结束 Python 进程，表示故意失败 |
| `\"` | 在这条 shell 命令的双引号内部保留双引号 |

预期观察：

```text
output: failure demo
returncode: 2
```

返回码 0 通常表示成功，非零通常表示失败。本实验明确要求返回 2，所以出现 2 符合任务要求。

## 3. A 和 B 只改了哪里？

两组都使用 `anthropic/kimi-for-coding`，加载相同的基础配置与模型配置。

A 使用原版 `system_template`：

```text
You are a helpful assistant that can interact with a computer.
```

B 在同一个配置字段中增加一句约束：

```text
When the user provides an exact command, execute it unchanged as a standalone action without adding other shell commands.
```

意思是：**用户提供明确命令时，原样作为独立动作执行，不要追加其他 shell 命令。**

`prompt-b.yaml` 中写的是完整的新 `system_template`，因此需要保留原来的第一句。后加载的配置会覆盖这个字段。

## 4. 实际行为有什么不同？

A 在 Python 命令后追加了：

```bash
; echo "RETURN_CODE=$?"
```

`$?` 读取上一条命令的返回码，因此打印出了 Python 的返回码 2。

但是，整段 shell 命令最后执行的是 `echo`，它成功返回 0，所以 Environment 记录的是：

```text
returncode: 0
output: failure demo
        RETURN_CODE=2
```

**Python 的返回码是 2；整段 shell 命令的返回码是 0。两者对应的执行对象不同。**

B 没有追加 `echo`，Environment 直接得到：

```text
returncode: 2
output: failure demo
```

两组随后都提出完成命令：

```bash
echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT
```

Agent 识别这个完成标记，最终记录 `Submitted`。这里的“提交”表示结束 Agent 任务，不代表执行了 Git 提交。

## 5. 对照结果与消耗

| 对比项 | A：原版提示词 | B：增加独立执行约束 |
| --- | --- | --- |
| 是否追加 shell 命令 | 是，追加 `echo` | 否 |
| 故意失败的 Python 命令执行次数 | 1 | 1 |
| 工具记录的返回码 | 0 | 2 |
| 是否能从观察中看出 Python 失败 | 能，输出中有 `RETURN_CODE=2` | 能，`returncode` 直接为 2 |
| 是否修复或重试 | 否 | 否 |
| 最终状态 | `Submitted` | `Submitted` |
| 模型调用次数 | 2 | 2 |
| 输入 token 合计 | 2107 | 2866 |
| 输出 token 合计 | 306 | 1021 |
| 总 token | 2413 | 3887 |
| 轨迹记录的费用 | 0.0，实际金额未确认 | 0.0，实际金额未确认 |

token 数据来自各条顶层 `assistant` 消息的 `extra.response.usage`，逐次累加；不要把嵌套的重复记录再次计算。输入合计包含每次请求重新携带的历史消息。

这次 B 比 A 多使用 1474 个 token。输出 token 可能包含推理 token，不能直接等同于屏幕上回复文字的长度。

费用记录为 0 不足以证明免费。当前配置使用 `cost_tracking: ignore_errors`，费用计算失败时可能记录为 0；本次先比较调用次数和 token 消耗。

## 6. 怎么从轨迹验收？

1. 看初始 `system`、`user` 消息：确认提示词差异和任务内容。
2. 看顶层 `assistant.extra.actions`：确认模型提出了什么命令。
3. 看后续 `role: tool` 的 `content`：确认实际输出和返回码。
4. 看下一条 `assistant`：确认是否重试，以及如何结束。
5. 看 `info.exit_status`、`info.model_stats` 和各次 `usage`：核对结束状态与消耗。

完成命令对应的工具消息中，两组都有 `returncode: -1` 和 `action was not executed`。这是完成信号被框架处理后留下的占位记录，不应当当成 Python 命令执行失败的返回码；应结合最终的 `Submitted` 判断。

## 7. 今天能得出什么结论？

本次 B 更符合“命令作为独立动作执行”的要求，工具返回码也直接保留了 Python 的失败状态。A 能看到失败，但追加命令改变了整段 shell 的返回码。

**提示词可以约束模型如何组织动作；是否遵守，仍要查看实际轨迹。**

这只是各跑一次的观察，不能保证以后 B 都这样执行，也不能说明增加这句话必然增加 token。两组模型名称一致，但记录的是模型别名，没有固定到可核实的底层模型快照。


---

{% post_link mini-swe-agent-index "系列目录" %} · {% post_link mini-swe-agent-04-environment "上一篇：命令执行、返回码与超时" %} · {% post_link mini-swe-agent-06-failures "下一篇：区分环境、模型与任务问题" %}
