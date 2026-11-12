---
layout: post
title: "mini-SWE-agent 学习笔记 02：从入口追到 Agent 循环"
date: 2026-11-05 12:00:00
slug: mini-swe-agent-02-loop
tags:
  - mini-SWE-agent
  - Python
  - AI Agent
categories:
  - 技术学习
---

整理本次 mini-swe-agent 2.4.6 的源码阅读与实验记录。

<!-- more -->

学习目标：解释任务怎样启动、每轮怎样请求模型和执行动作，以及什么情况下继续或结束。本文对应交互式代理和本地执行环境。

> 💡 **主线：Model 提动作、Environment 执行、Agent 管循环**

> 代码片段用于阅读，不要直接粘贴到 shell 终端执行。

## 1. 从 mini 命令进入 main()

`pyproject.toml` 注册命令入口：

```toml
mini = "minisweagent.run.mini:app"
```

```text
mini → Typer main() → 合并配置与任务 → 创建 Model / Environment / Agent → agent.run(task)
```

| 模块 | 职责 |
| --- | --- |
| `run/mini.py` | 加载配置、取得任务、组装对象 |
| `agents/default.py` | 核心循环、预算检查、消息历史、轨迹保存 |
| `agents/interactive.py` | 打印消息、确认命令、处理中断和继续询问 |
| `models/litellm_model.py` | 调用模型、解析工具调用、整理观察消息 |
| `environments/local.py` | 在本机执行命令，检测完成信号 |
| `exceptions.py` | 定义完成、超限、格式错误等流程控制信号 |

`default_type="interactive"` 表示：配置未指定 `agent_class` 时，默认创建 `InteractiveAgent`。

`-c` 指定本次启动读取的配置，下次单独运行 `mini` 不会自动记住这些参数。`--exit-immediately` 设置 `confirm_exit=False`，省去完成后追加任务的询问，不会跳过执行前确认。

## 2. self、父类与子类

```python
class InteractiveAgent(DefaultAgent):
    ...
```

`InteractiveAgent` 继承核心流程，并重写部分方法增加交互。父类和子类方法操作的是同一个对象。

- `self`：实际调用方法的对象，本次是创建出的交互式代理。
- `self.xxx()`：从对象的类开始找方法，优先使用子类重写的版本。
- `super().xxx()`：从父类方向找方法，复用父类实现；`self` 仍是原来的对象。

| 方法 | DefaultAgent | InteractiveAgent |
| --- | --- | --- |
| `run()` | 定义主循环 | 直接继承 |
| `step()` | 请求模型，再执行动作 | 打印分隔线、调用父类步骤、处理中断 |
| `query()` | 检查限制、调用模型、记录回复 | 增加人工模式、等待提示、超限询问 |
| `execute_actions()` | 执行动作并加入观察 | 增加执行确认和完成时询问 |
| `add_messages()` | 添加消息历史 | 先打印，再调用父类添加历史 |
| `save()` | 保存轨迹 | 直接继承 |

所以调用路线可能在两个文件之间切换：

```text
DefaultAgent.run()
  → InteractiveAgent.step()
  → DefaultAgent.step()
  → InteractiveAgent.query()
  → DefaultAgent.query()
```

## 3. 对象属性与消息历史

初始化时的核心数据是：

```python
self.model = model
self.env = env
self.messages: list[dict] = []
```

`model` 是传入参数，`self.model` 是保存在代理对象上的属性。`self.messages` 保存消息历史，通过 `add_messages()` 中的 `extend()` 追加。

列表元素是字典，但没有要求每条消息都具有相同字段；具体格式取决于模型实现和消息用途。

| 字段 | 含义 | 主要来源 |
| --- | --- | --- |
| `role` | 消息角色，如 system、user、assistant、tool | mini 或模型接口 |
| `content` | 消息正文 | 提示词、模型回复或执行结果 |
| `tool_calls` | 模型提出的工具调用 | 模型接口 |
| `tool_call_id` | 将结果关联到对应工具调用 | 工具调用关联信息 |
| `extra` | 动作、费用、时间戳等附加记录 | mini |

`extra.actions` 是解析后的动作，`extra.response` 保存模型响应，观察消息的 `extra.raw_output` 保存原始命令输出。重复保存的响应字段不代表发生了额外调用。

当前 LiteLLM 实现发送请求前会去掉消息中的 `extra`，工具定义另外通过 API 的 `tools` 参数发送。`info.config` 是配置记录，不会全部直接发给模型。

## 4. run() 与单轮执行

交互式代理继承 `DefaultAgent.run()`。它先渲染模板，添加初始 system、user 消息，再进入循环。

正常路径可简化为：

```python
while True:
    self.step()
    self.save(self.config.output_path)
    if self.messages[-1].get("role") == "exit":
        break
```

实际源码把保存放在 `finally` 中，正常执行或异常发生后都会尝试保存。**finally 本身不是终止条件。** 普通异常还可能向外传播，直接离开函数。

交互式 `step()` 打印分隔线，调用父类方法，并捕获 Control + C 引起的 `KeyboardInterrupt`。父类方法是：

```python
def step(self) -> list[dict]:
    return self.execute_actions(self.query())
```

先计算参数 `self.query()`，再将回复交给 `self.execute_actions()`。

```text
run() → InteractiveAgent.step() → DefaultAgent.step()
→ query() → execute_actions() → 保存轨迹
→ 最后一条为 exit：结束；否则继续
```

此图是正常路径；异常会进入后文的专门分支。

## 5. query()：检查预算并请求模型

确认模式下，交互式 `query()` 显示等待提示，再调用父类 `query()`。

```text
检查次数、费用与时间 → 计数加一 → model.query(messages) → 记录回复和费用
```

- 限制为 0 表示关闭该项限制。
- `step_limit=12` 时，已经尝试 12 次请求后阻止下一次请求；一次回复可以包含多个动作。
- 费用在请求前检查、回复后累计，最后一次请求可能使累计费用超过阈值。
- Kimi Code 配置使用 `cost_tracking: ignore_errors`，无法计价时记录为 0。不能据此认为没有消耗额度，也不能依赖美元限制控制未计价消耗。
- 时间限制也是请求前检查，不会在到时的一瞬间中断正在执行的请求或命令。

## 6. execute_actions()：确认、执行与观察

```text
取得 actions → 按模式确认 → env.execute(action)
→ 整理 outputs 为观察 → 加入 messages → 返回循环
```

`confirm` 模式下，未匹配白名单的动作需要确认；`yolo` 模式下不询问。拒绝命令或按 Control + C 后补充指令，通常是加入用户消息后继续，不等于终止任务。

命令失败、pytest 测试失败通常作为观察返回，供模型修复，不会仅因返回码非零而结束任务。

## 7. 正常完成：Submitted 如何到达 break

本地环境执行命令后调用 `_check_finished(output)`。输出去掉开头空白后，第一行等于完成信号，且返回码为 0，才触发 `Submitted`。

```bash
echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT
```

```text
完成标记且返回码为 0 → Submitted → 交互代理可询问追加任务
→ run() 加入 exit → 保存 → break
```

`Submitted` 是 `InterruptAgentFlow` 的子类，用异常机制传递完成信号。`Submitted` 说明代理已提交，不保证代码正确，仍需独立验收。

## 8. 超限后的继续与结束

```text
次数或费用超限 → 交互终端可询问新限制；非交互终端结束
时间超限 → 结束
```

达到 12 次后出现 `New step limit:`，是交互式代理在询问是否调整预算。时间超限不会进入这个询问。

## 9. 格式错误与普通异常

`FormatError` 指模型没有正确提供工具调用，例如没有工具调用、工具未知或缺少 command 参数，不是 pytest 测试失败。

```text
格式错误 → 连续计数加一
未超限：加入纠正提示继续；达到上限：RepeatedFormatError → 保存并结束
```

默认连续上限为 3，正常执行一轮后计数清零。设为 0 则关闭连续错误限制，其他预算仍可生效。

未处理的普通异常，例如 API 认证失败，由 `run()` 记录并重新抛出：

```python
except Exception as e:
    self.handle_uncaught_exception(e)
    raise
finally:
    self.save(self.config.output_path)
```

程序先记录异常，执行 finally 尝试保存，再让异常向外传播。此路径直接离开 run，不经过末尾的 break 判断。

## 10. 继续与终止条件速查

| 情况 | 行为 |
| --- | --- |
| 普通动作完成或命令失败 | 加入观察，继续循环 |
| 用户拒绝命令、补充纠正 | 加入用户消息，通常继续循环 |
| 收到完成信号 | 结束；启用结束确认时也可追加任务 |
| 调用次数或费用超限 | 交互终端可调整限制，否则结束 |
| 时间超限 | 结束 |
| 格式错误未达到连续上限 | 加入纠正提示，继续 |
| 连续格式错误达到上限 | 以 RepeatedFormatError 结束 |
| 未处理的普通异常 | 记录、保存后抛出，异常退出 |

## 11. 验收：解释三条实际路径

1. **正常完成**：入口 → 组装对象 → run 循环 → query → 执行动作 → 观察 → 完成信号 → Submitted → exit 消息 → 保存 → break。
2. **达到 12 次限制**：query 检查 → LimitsExceeded → 交互代理询问新限制 → 重新检查；非交互终端则保存后结束。
3. **API 认证失败**：model.query 抛出认证异常 → run 记录异常 → finally 保存 → 异常向外传播。

阅读源码时，区分模型回复、动作命令、环境观察和 Agent 流程控制。判断任务是否完成，还要对照文件内容与独立测试结果。


---

{% post_link mini-swe-agent-index "系列目录" %} · {% post_link mini-swe-agent-01-start "上一篇：第一次运行与提示词" %} · {% post_link mini-swe-agent-03-messages "下一篇：模型接口与消息历史" %}
