---
layout: post
title: "mini-SWE-agent 学习笔记 03：模型接口与消息历史"
date: 2026-11-05 12:00:00
slug: mini-swe-agent-03-messages
tags:
  - mini-SWE-agent
  - Python
  - AI Agent
categories:
  - 技术学习
---

整理本次 mini-swe-agent 2.4.6 的源码阅读与实验记录。

<!-- more -->

学习目标：理解消息如何发送给模型、回复如何转换成动作，以及第二次调用相比第一次新增了什么信息。

> 💡 **主线：Model 提动作、Environment 执行、Agent 管循环。**

## 1. messages、message、response 和 role

| 名称 | 含义 |
| --- | --- |
| `messages` | 消息列表，保存对话历史 |
| `message` | 一条消息，通常是一个字典 |
| `response` | 一次模型 API 请求返回的完整结果，包含回复消息、token 用量等 |
| `role` | 消息中的角色标签，用于区分这条消息来自哪里 |

`response` 是完整响应；`assistant`、`tool` 是 `role` 的取值，不是与 response 并列的数据类型。

| role | 表示什么 |
| --- | --- |
| `system` | 系统角色和行为说明 |
| `user` | 用户任务、补充要求，也可能是 mini 追加的纠正提示 |
| `assistant` | 模型生成的回复，可能包含工具调用 |
| `tool` | 工具执行后返回的结果 |
| `exit` | mini 内部使用的结束消息标记 |

注意：`tool` 消息通常由环境提供原始结果，经模型适配层整理后，由 Agent 加入历史，不是模型自己生成的执行结果。

## 2. response 里面包含 assistant 消息

在当前 LiteLLM 的 Chat Completions 风格返回结构中，完整响应可简化为：

```python
response = {
    "choices": [
        {
            "message": {
                "role": "assistant",
                "content": "我先查看当前目录。",
                "tool_calls": [...],
            }
        }
    ],
    "usage": {...},
}
```

mini 从中取出回复消息：

```python
message = response.choices[0].message.model_dump()
```

`choices[0]` 表示第一个候选结果，`.message` 是其中的回复消息，`model_dump()` 将它转换为字典。

源码：[litellm_model.py：取出回复并补充记录](https://github.com/Ubi-olio/mini-swe-agent/blob/99b1836c/src/minisweagent/models/litellm_model.py#L99)。

## 3. 一条消息中的常见字段

| 字段 | 含义 | 来源 |
| --- | --- | --- |
| `role` | 消息角色 | mini 或模型接口 |
| `content` | 消息正文 | 提示词、模型回复或执行结果 |
| `tool_calls` | 模型提出的结构化工具调用 | 模型接口 |
| `tool_call_id` | 将工具结果关联到对应调用 | 工具调用关联信息 |
| `extra` | 动作、费用、响应记录和时间戳等附加信息 | mini |

`self.messages` 定义为 `list[dict]`，并没有要求每条消息都包含完全一样的字段。

### extra 中保存什么

- `actions`：mini 从模型工具调用中解析出的执行清单。
- `response`：完整模型响应的保存副本。
- `cost`：本次记录的费用。
- `timestamp`：时间戳。
- 观察消息中的 `raw_output`：命令的原始输出文本。

轨迹中的 `extra.response.choices[0].message` 会重复保存 assistant 消息。这不代表又调用了一次模型。查找消息顺序时，应看 `messages` 数组的直接元素，不要把嵌套响应里的 role 也算成新消息。

`reasoning_content`、`thinking_blocks` 是接口返回的思考相关字段，不保证展示模型全部内部过程。LiteLLM 可能在统一字段和 `provider_specific_fields` 中重复保留它们。

## 4. 输入方向：历史消息如何发送给模型

Agent 先将当前历史交给模型适配层：

```python
message = self.model.query(self.messages)
```

源码：[default.py：请求模型](https://github.com/Ubi-olio/mini-swe-agent/blob/99b1836c/src/minisweagent/agents/default.py#L149)。

适配层整理消息：

```python
prepared = [{k: v for k, v in msg.items() if k != "extra"} for msg in messages]
```

这段代码复制每条消息，去掉 mini 自己添加的 `extra`。原始历史中的记录仍然保留，不是从轨迹中删除。

例如：

```python
# 本地记录
{
    "role": "assistant",
    "content": "我先查看目录。",
    "tool_calls": [...],
    "extra": {"actions": [...], "response": {...}, "cost": 0.0},
}

# 发送前去掉 extra
{
    "role": "assistant",
    "content": "我先查看目录。",
    "tool_calls": [...],
}
```

适配层还会调整 Anthropic 思考块顺序，并按配置处理缓存标记。

源码：[litellm_model.py：整理请求消息](https://github.com/Ubi-olio/mini-swe-agent/blob/99b1836c/src/minisweagent/models/litellm_model.py#L76)。

最后交给 LiteLLM：

```python
litellm.completion(
    model=self.config.model_name,
    messages=messages,
    tools=[BASH_TOOL],
    **(self.config.model_kwargs | kwargs),
)
```

- `messages`：整理后的对话历史。
- `tools`：bash 工具定义，包括名称、用途和参数格式。它是独立参数，不是一条 role 消息。
- `model` 和其他参数：决定模型、协议、接口地址等。

LiteLLM 再适配目标服务的请求格式。本次配置的 `anthropic/` 前缀用于选择协议，实际请求地址由 Kimi Code 的 `api_base` 指定。

源码：[litellm_model.py：发送请求](https://github.com/Ubi-olio/mini-swe-agent/blob/99b1836c/src/minisweagent/models/litellm_model.py#L64)。

## 5. 返回方向：模型回复如何变成动作

```python
actions = self._parse_actions(response)
message = response.choices[0].message.model_dump()
message["extra"] = {
    "actions": actions,
    "response": response.model_dump(),
    **cost_output,
    "timestamp": time.time(),
}
return message
```

适配层先解析工具调用，再把动作和其他记录放入 extra。这时只是整理命令，还没有执行。

Agent 收到消息后累计费用、加入历史，再安排执行动作。Environment 执行后返回 outputs，适配层将结果格式化为观察消息，由 Agent 加入历史。

源码：[litellm_model.py：解析和整理回复](https://github.com/Ubi-olio/mini-swe-agent/blob/99b1836c/src/minisweagent/models/litellm_model.py#L89)、[interactive.py：执行动作并加入观察](https://github.com/Ubi-olio/mini-swe-agent/blob/99b1836c/src/minisweagent/agents/interactive.py#L124)。

```text
messages → 移除 extra → LiteLLM 请求 → response
→ assistant 消息与 actions → Environment 执行
→ tool 观察 → 加入 messages → 下一轮
```

## 6. assistant 和 tool 如何配对

模型先返回 assistant 消息，提出调用：

```python
{
    "role": "assistant",
    "content": "我先查看当前目录。",
    "tool_calls": [
        {
            "id": "call_001",
            "type": "function",
            "function": {
                "name": "bash",
                "arguments": '{"command": "ls -la && pwd"}',
            },
        }
    ],
}
```

命令执行后，观察消息类似：

```python
{
    "role": "tool",
    "tool_call_id": "call_001",
    "content": "文件列表和当前目录等执行结果",
}
```

相同的调用编号将动作和结果关联起来。模型生成 response 时，命令尚未执行，因此本次 response 中不会已经包含该命令的实际执行结果；结果作为后续 tool 消息加入。

一条 assistant 消息可以提出多个工具调用，对应多个 tool 消息。用户纠正时也会插入 user，因此消息并非永远严格交替。

## 7. 验收：第二次调用新增了什么

以计算器任务的成功轨迹为例：

| 调用 | messages 内容 | 另外提供的参数 |
| --- | --- | --- |
| 第一次 | system 角色提示、user 任务和操作说明 | bash 工具定义等 |
| 第二次 | 保留前两条，新增上一轮 assistant 回复和对应 tool 观察 | bash 工具定义等 |

```text
第一次调用前：
system → user

第一次回复并执行后，第二次调用前：
system → user → assistant（ls -la && pwd）→ tool（文件列表和目录）
```

新增信息分别由谁产生：

- **assistant 回复**：由模型产生，适配层整理，Agent 加入历史。
- **tool 观察**：由 Environment 产生原始结果，适配层整理，Agent 加入历史。
- **extra**：mini 的本地记录，发送前移除，不是第二次全部发给模型的新内容。

> **验收结论：第二次调用保留最初的系统提示和任务，新增上一轮的 assistant 回复（含工具调用）及对应的 tool 观察。模型据此知道当前目录和文件列表，决定下一步读取代码。发送前适配层会移除每条消息的 extra。**

## 8. 容易混淆的点

- `response` 是完整响应，assistant 是消息角色；两者不是并列角色。
- `tool_calls` 是模型提出的操作，tool 消息是操作执行后的结果。
- `raw_output` 可以是代码、测试结果或报错，不专指读取代码。
- `content` 要结合 role 理解：assistant 的正文是模型回复，tool 的正文是执行观察。
- `info.config` 中的模板含有占位符；messages 中的初始 user 消息是实际渲染后的内容。
- 本次学习直接阅读已有轨迹和源码，不需要重新调用模型 API。


---

{% post_link mini-swe-agent-index "系列目录" %} · {% post_link mini-swe-agent-02-loop "上一篇：从入口追到 Agent 循环" %} · {% post_link mini-swe-agent-04-environment "下一篇：命令执行、返回码与超时" %}
