---
layout: post
title: "mini-SWE-agent 学习笔记 09：为什么测试失败，返回码却是零"
date: 2026-11-05 12:00:00
slug: mini-swe-agent-09-pipefail
tags:
  - mini-SWE-agent
  - Python
  - AI Agent
categories:
  - 技术学习
---

做完运行摘要后，有个现象一直让我困惑：pytest 明明失败，为什么“命令失败数”还是 0？沿着返回码的数据来源追踪，问题最终指向 Shell 的管道规则。

截至本篇整理，我已经跑过默认管道实验，并在本机 Bash 手册中找到 pipefail 的说明；还没有完成项目接入，也没有实际核对开启 pipefail 后的实验结果。

<!-- more -->

## 先明确谁在执行

模型 API 返回工具调用，其中包含命令文字；Agent 提取动作，Environment 执行。比如：

```bash
python -m pytest -q 2>&1 | tail -20
```

pytest 运行测试，tail 显示最后 20 行。两个程序有各自的退出状态。

## 从摘要往回追

`LocalEnvironment.execute()` 中：

```python
result = _run(command, cwd, os.environ | self.config.env, timeout or self.config.timeout)
output = {"output": result.stdout, "returncode": result.returncode, "exception_info": ""}
```

继续追到 `_run()`，发现使用 `subprocess.Popen(command, shell=True, ...)` 启动进程，最后使用 `process.returncode` 构造 CompletedProcess。

```text
Shell 执行命令
→ process.returncode
→ result.returncode
→ Environment 返回结果
→ Agent 统计
```

先提出假设：Shell 是否已经返回了 0，后面只是照实记录？

## 拿掉 Agent 做最小实验

```bash
python - <<'PY'
import subprocess

for command in ["false", "true", "false | true"]:
    result = subprocess.run(command, shell=True)
    print(f"命令：{command}，返回码：{result.returncode}")
PY
```

实际结果：

```text
命令：false，返回码：1
命令：true，返回码：0
命令：false | true，返回码：0
```

false 必定失败，true 必定成功。这个现象在没有模型时也存在，研究范围因此缩小到 Shell 管道退出状态。

输入多行命令时，我把结尾写成了 `PY'`，终端一直出现 `heredoc>`。结束标记必须单独一行写 `PY`，不带引号或空格；开头的 `<<'PY'` 才需要那对引号。

## 不知道 pipefail 时怎么查

这次是助手先提出 pipefail，再带我查证的。对我更有价值的，是怎样在事先不知道名称的情况下找到它：

1. 发现失败与最终返回码不一致。
2. 用最小实验复现。
3. 问“管道最终返回码由谁决定”。
4. 查 Bash 手册的 Pipelines 部分。
5. 读到 pipefail，再查启用方法。

```bash
man bash
```

小写 g 回到开头，输入 `/pipefail` 回车搜索，n 找下一处，q 退出。若出现 Pattern not found，先回车关提示，再从开头搜索。

本机手册说明：默认取最后一个命令的退出状态；启用 pipefail 后取管道位置上最右侧的非零状态，全部成功才返回 0。最右侧不是时间上最后退出。

## 下一步先预测，再验证

下面是计划中的实验，尚未把它当作实际结果：

```bash
python - <<'PY'
import subprocess

for setting in ["set +o pipefail", "set -o pipefail"]:
    result = subprocess.run(
        ["bash", "-c", f"{setting}; false | true"]
    )
    print(f"设置：{setting}，返回码：{result.returncode}")
PY
```

预测关闭时为 0，启用时为 1。显式使用同一个 Bash，让两组只改变选项。

POSIX 上 `shell=True` 默认使用 `/bin/sh`，不会自动使用当前交互终端的 zsh。这个行为可查 [Python subprocess 文档](https://docs.python.org/3/library/subprocess.html#subprocess.Popen)。

## 为什么不能马上改项目

pipefail 改变管道的返回规则，不是仅仅增加一个日志字段。`程序 | head -5` 中，head 提前结束可能使上游遇到断管道，整条命令因此显示非零。还需要确认当前 Shell 支持哪些选项，以及失败统计究竟想衡量什么。

它也不能解决所有返回码覆盖问题：`失败命令; echo ...` 是顺序命令，不能只靠 pipefail 保留前一个失败。

另一种设计是记录各段返回码，但那是范围更大的实现。当前还没有修改 Environment。

我想掌握的是这种定位能力：现象 → 最小实验 → 找到所属层 → 查对应机制 → 预测修改影响。到达 Shell 的知识边界时，就补管道、退出状态和子进程的知识。

## 资料入口

- 本机 `man bash` 的 Pipelines 和 set 说明（本次实际查阅）。
- [GNU Bash 手册：Pipelines](https://www.gnu.org/software/bash/manual/html_node/Pipelines.html)。
- [本次版本的本地执行器](https://github.com/Ubi-olio/mini-swe-agent/blob/99b1836c/src/minisweagent/environments/local.py)。


---

{% post_link mini-swe-agent-index "系列目录" %} · {% post_link mini-swe-agent-08-evaluation "上一篇：建立八项任务的小型测评集" %}
