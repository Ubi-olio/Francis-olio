---
layout: post
title: "mini-SWE-agent 学习笔记 06：区分环境、模型与任务问题"
date: 2026-11-05 12:00:00
slug: mini-swe-agent-06-failures
tags:
  - mini-SWE-agent
  - Python
  - AI Agent
categories:
  - 技术学习
---

整理本次 mini-swe-agent 2.4.6 的源码阅读与实验记录。

<!-- more -->

本次练习完成于 2026-11-02，对应原计划第 9 天。文件沿用练习目录的 day8 编号。

## 1. 学习目标

制造缺依赖、超时和需求不明确三种情况，根据实际动作与观察判断问题来源。

**命令失败、模型处理错误、Agent 结束和任务验收通过，是不同的判断。**

## 2. 缺依赖实验

完整轨迹（本地记录）

要求原样、单独执行一次：

```bash
python -c "import day8_missing_dependency_demo"
```

这里故意使用不存在的模块，模拟缺依赖，无需卸载任何软件。

模型实际提出：

```bash
cd "$PWD" && python -c "import day8_missing_dependency_demo"; echo "RETURN_CODE=$?"
```

工具输出包含：

```text
ModuleNotFoundError: No module named 'day8_missing_dependency_demo'
RETURN_CODE=1
```

### 为什么工具的 returncode 却是 0？

`$?` 代表上一条命令的返回码，`echo` 把它打印出来。

- Python 导入失败，返回码为 1。
- 最后的 `echo` 打印成功，返回码为 0。
- 整段 shell 命令的返回码取最后执行命令的返回码，因此工具记录为 0。

### 验收

缺模块是环境问题；模型正确识别原因，没有安装、修复或重试，最终 `Submitted`，调用模型 2 次。

但模型追加了命令，未遵守“原样、单独执行”；还引用了 `$PWD`，未严格遵守不读取环境变量。这些属于模型行为问题。它自称“原样执行”，也与动作不完全一致。

## 3. 超时实验

完整轨迹（本地记录）

本次启动配置：

```text
environment.timeout=2
```

要求执行：

```bash
python -u -c "import time; print(\"before sleep\"); time.sleep(5); print(\"after sleep\")"
```

过程：

```text
打印 before sleep
→ 等待 5 秒
→ 到第 2 秒时 Environment 终止进程
→ 未执行到打印 after sleep
```

工具记录：

```text
output: before sleep\n
returncode: -1
exception_type: TimeoutExpired
exception_info: … timed out after 2 seconds
```

这里的 `-1` 是 Environment 捕获异常后填写的值，不能只凭它判断超时，需要结合异常说明。`python -u` 让输出及时写出，便于保留中断前的信息。

### 验收

模型执行指定命令，正确识别超时，没有修改命令、延长时间或重试。最终 `Submitted`，调用模型 2 次。

本实验是命令所需时间超过环境允许时间，属于故意制造的环境限制问题。在其他任务中，超时也可能由模型选择不合适的命令引起，不能看到超时就一律归因于环境。

## 4. 需求不明确实验

完整轨迹（本地记录） · `最终程序`

任务只要求：

```text
把 greeting.py 的问候方式改得更好一点。
```

模型先读取程序，然后把“更好”理解为“更温暖、更友好”，增加祝福语与表情。它说明了自己的选择，但没有询问用户想要哪种风格。

程序运行成功。模型还检查了输出字节、尝试不同姓名并再次读取文件，最终 `Submitted`，调用模型 6 次。

### 验收

需求没有规定语言、风格、长度和期望输出，因此缺少客观验收标准。这属于任务定义问题。

直接选择一种风格并不自动算模型错误，因为任务没有要求必须先询问。准确结论是：**执行成功，但无法仅凭运行结果判断是否符合用户预期。**

更明确的任务可以写成：

```text
把 greet(name) 改为返回中文问候，格式固定为“你好，{name}！”。
保留函数名和参数，不添加其他祝福语或表情。运行程序验证输出。
```

### 额外观察：模型也会误判工具反馈

模型曾因为看到 `\u2014` 等 Unicode 转义，怀疑输出编码有问题。但 JSON 转义本身不能证明编码错误；后续字节输出中的 `e2 80 94` 正是破折号的 UTF-8 编码。

这段反馈说明：模型对观察的解释也需要证据，不能把它的推测直接当成环境故障。

## 5. 三类问题的判断方式

| 来源 | 判断方法 | 本次例子 |
| --- | --- | --- |
| 环境 | 命令所需运行条件是否满足？ | 缺模块；5 秒命令遇到 2 秒限制 |
| 模型 | 实际动作是否遵守明确要求？对结果的解释有证据吗？ | 追加命令；根据 JSON 转义怀疑编码问题 |
| 任务定义 | 是否说清目标和验收标准？ | “更好一点”没有具体标准 |

同一条轨迹可以同时暴露多类问题。

`Submitted` 表示 Agent 通过完成信号结束，不等于程序成功，也不等于满足用户需求。完成信号附近的 `action was not executed` 占位记录应结合最终状态理解。

## 6. 接下来补上源码串联

实验用于验证源码理解。接下来沿一条具体数据路径阅读：

```text
终端中的 -t 任务文字
→ main() 的 task 参数
→ 合并配置中的 run.task
→ agent.run(run_task)
→ 渲染提示词，加入 self.messages
→ model.query(self.messages)
→ 模型接口请求
```

每次阅读都回答：谁调用谁，传入什么，返回什么，下一步去哪。先理解正常主线，再补异常和其他分支。


---

{% post_link mini-swe-agent-index "系列目录" %} · {% post_link mini-swe-agent-05-prompts "上一篇：只改一项提示词的对照实验" %} · {% post_link mini-swe-agent-07-batch "下一篇：运行摘要与批量任务" %}
