---
layout: post
title: "mini-SWE-agent 学习笔记 04：命令执行、返回码与超时"
date: 2026-11-05 12:00:00
slug: mini-swe-agent-04-environment
tags:
  - mini-SWE-agent
  - Python
  - AI Agent
categories:
  - 技术学习
---

整理本次 mini-swe-agent 2.4.6 的源码阅读与实验记录。

<!-- more -->

学习目标：理解 Environment 如何执行命令，制造普通失败和超时，并沿轨迹、源码追踪处理过程。

> 💡 **命令失败或超时不等于 Agent 必须结束。执行结果可以作为观察交给模型，由模型决定下一步。**

## 1. 从动作到执行结果

Model 提出动作，Agent 安排执行，LocalEnvironment 真正执行命令。

源码：[local.py：execute()](https://github.com/Ubi-olio/mini-swe-agent/blob/99b1836c/src/minisweagent/environments/local.py#L24)。

```python
command = action.get("command", "")
cwd = cwd or self.config.cwd or os.getcwd()
result = _run(command, cwd, os.environ | self.config.env, timeout or self.config.timeout)
```

| 参数 | 含义 |
| --- | --- |
| `command` | 要执行的命令字符串 |
| `cwd` | 执行目录，依次使用调用时指定的目录、配置目录、当前进程目录 |
| `os.environ | self.config.env` | 合并运行环境变量，同名项由配置覆盖 |
| `timeout` | 单条命令的执行超时秒数，未单独指定时使用环境配置 |

命令返回后，执行器整理结果：

```python
output = {
    "output": result.stdout,
    "returncode": result.returncode,
    "exception_info": "",
}
```

| 字段 | 含义 |
| --- | --- |
| `output` | 收集到的命令输出 |
| `returncode` | 命令退出码，通常 0 表示成功，非零表示失败 |
| `exception_info` | 执行器捕获的异常说明；普通非零退出不一定产生异常 |

## 2. 输出如何收集

源码：[local.py：_run()](https://github.com/Ubi-olio/mini-swe-agent/blob/99b1836c/src/minisweagent/environments/local.py#L72)。

```python
process = subprocess.Popen(
    command,
    shell=True,
    ...,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
)
```

- `shell=True`：通过 shell 执行命令字符串，支持管道、分号等语法。
- `stdout=PIPE`：收集标准输出。
- `stderr=STDOUT`：将标准错误合并到标准输出，因此 output 中也可能包含报错。

```python
stdout, _ = process.communicate(timeout=timeout)
```

等待进程结束并收集输出；超过规定时间则触发 `TimeoutExpired`。

## 3. 第一次失败实验：为什么返回码变成了 0

轨迹：failure.traj.json（本地记录）。

模型实际提出：

```bash
pwd && python -c "import sys; print(\"failure demo\"); sys.exit(2)"; echo "return_code=$?"
```

观察包含：

```text
returncode：0
output：
  当前目录
  failure demo
  return_code=2
```

Python 子命令以 2 退出，`$?` 取得该退出码；但最后执行的 echo 成功，导致整条 shell 命令的返回码为 0。

因此，这次证明的是模型能从输出中读出子命令失败，没有直接证明 mini 收到非零 returncode 后的处理。

同理，`pytest ... | tail ...` 的管道返回码通常来自最后的 tail，不能只看 returncode 为 0 就认定测试成功。

此外，本次第一次模型回复缺少工具调用，触发了格式纠正提示；模型下一轮才提供动作。这与命令执行失败是两类不同问题。

## 4. 普通失败实验：returncode 为 2

轨迹：failure-direct.traj.json（本地记录）。

任务要求只执行原始命令，不附加 echo、管道等操作，不修复或重试。

```bash
python -c "import sys; print(\"failure demo\"); sys.exit(2)"
```

验收结果：

| 项目 | 结果 |
| --- | --- |
| 输出 | `failure demo`，末尾有换行 |
| 返回码 | `2` |
| 执行器异常说明 | 空 |
| 后续动作 | 模型提出完成命令，没有重试 |
| 最终状态 | `Submitted` |
| 模型调用次数 | `2` |

### 为什么非零退出没有结束 Agent

1. `_run()` 收到进程退出结果，返回 CompletedProcess；这里不会仅因非零退出码而抛出异常。
2. `execute()` 把退出码 2 和输出放进结果字典。
3. `_check_finished()` 没发现完成信号，正常返回结果。
4. Agent 将结果整理为 tool 观察，加入消息历史。
5. 下一次调用中，模型看到这是故意失败，按任务要求提交。

> **普通失败的验收结论：非零退出码被记录为观察，没有自动终止 Agent；模型收到结果后继续提交。**

## 5. 超时实验：2 秒限制与 5 秒等待

轨迹：timeout.traj.json（本地记录）。

启动时额外指定：

```bash
-c environment.timeout=2
```

这是本次环境的单条命令超时，不是模型 API 超时，也不是整个 Agent 的运行时限。

模型执行：

```bash
python -u -c "import time; print(\"before sleep\", flush=True); time.sleep(5); print(\"after sleep\", flush=True)"
```

`-u` 和 `flush=True` 使输出及时写出，避免文字还留在缓冲区时进程就被终止。

验收结果：

| 项目 | 结果 |
| --- | --- |
| 环境超时配置 | `2` 秒 |
| 输出 | `before sleep`，没有 after sleep |
| 返回码 | `-1` |
| 异常类型 | `TimeoutExpired` |
| 异常说明 | 包含 `timed out after 2 seconds` |
| 后续行为 | 模型确认超时，没有重试，提出完成命令 |
| 最终状态 | `Submitted` |
| 模型调用次数 | `2` |

### 超时的源码路径

源码：[local.py：等待与终止进程](https://github.com/Ubi-olio/mini-swe-agent/blob/99b1836c/src/minisweagent/environments/local.py#L86)。

```python
try:
    stdout, _ = process.communicate(timeout=timeout)
except subprocess.TimeoutExpired:
    os.killpg(process.pid, signal.SIGKILL) if os.name == "posix" else process.kill()
    stdout, _ = process.communicate()
    raise subprocess.TimeoutExpired(command, timeout, output=stdout)
```

1. 等待超过 2 秒，触发 TimeoutExpired。
2. macOS 上终止整个进程组，避免子进程继续运行。
3. 收集已有输出，再把超时异常向外抛出。

随后由 [execute() 的异常分支](https://github.com/Ubi-olio/mini-swe-agent/blob/99b1836c/src/minisweagent/environments/local.py#L31) 捕获，整理为：

```python
{
    "output": "before sleep\n",
    "returncode": -1,
    "exception_info": "超时异常说明",
    "extra": {"exception_type": "TimeoutExpired", ...},
}
```

这里的 `-1` 是 mini 在捕获异常后填写的标记，不是本次 Python 程序主动返回的退出码。

## 6. 两条处理路径对照

```text
执行命令
├─ 正常结束：收集输出与实际退出码
└─ 超时：终止进程组 → 收集部分输出 → 捕获异常填入 -1
→ 检查完成信号 → 返回观察 → Agent 继续
```

| 对比 | 普通失败 | 超时 |
| --- | --- | --- |
| 本次返回码 | Python 主动退出的 `2` | mini 填写的 `-1` |
| 是否触发执行器异常分支 | 否 | 是 |
| exception_info | 空 | 超时说明 |
| 输出 | failure demo | before sleep |
| 是否自动结束 Agent | 否 | 否 |

超时观察返回后，是否修复、重试或提交取决于任务和后续决策，并不是执行器强制要求模型提交。

## 7. 如何在轨迹里找证据

- 执行了什么：messages 中 assistant 的 `extra.actions[].command`。
- 实际返回什么：紧随其后的 tool 消息的 content，以及 extra 中的 raw_output、returncode、exception_info。
- 超时异常类型：对应 tool 消息的 `extra.exception_type`。
- 模型接下来做什么：下一条 assistant 消息中的解释和动作。
- 最终状态：`info.exit_status`。
- 调用次数：`info.model_stats.api_calls`。
- 超时配置：`info.config.environment.timeout`。

完成命令附近可能出现 `action was not executed` 的占位观察：本版本完成信号触发 Submitted 后，没有取得普通返回结果，适配层补出占位消息。不要把它与真实的 TimeoutExpired 混淆，应结合调用编号、异常类型和最终状态判断。

## 8. 本日验收

- [x] 理解标准输出和错误输出如何合并。
- [x] 制造一次返回码为 2 的失败，并追踪模型后续处理。
- [x] 理解追加 echo 或管道可能改变整条命令的返回码。
- [x] 制造一次超时，核对部分输出、返回码和异常类型。
- [x] 区分命令非零退出、执行器超时异常和 Agent 结束信号。

> **验收总结：Environment 将命令失败或超时整理为结果，Agent 把它作为观察加入历史。两次实验中，模型收到观察后均未重试，按要求提交，最终状态为 Submitted。**


---

{% post_link mini-swe-agent-index "系列目录" %} · {% post_link mini-swe-agent-03-messages "上一篇：模型接口与消息历史" %} · {% post_link mini-swe-agent-05-prompts "下一篇：只改一项提示词的对照实验" %}
