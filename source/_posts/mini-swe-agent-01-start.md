---
layout: post
title: "mini-SWE-agent 学习笔记 01：第一次运行与提示词"
date: 2026-11-05 12:00:00
slug: mini-swe-agent-01-start
tags:
  - mini-SWE-agent
  - Python
  - AI Agent
categories:
  - 技术学习
---

最初运行 mini-SWE-agent 时，我把“配置”“启动任务”和“模型动作”混在一起。终端打印了很长的英文，配置看似已经写好，为什么还会调用 API？这篇先把这些入口概念分开。

<!-- more -->

## 版本和模型

本轮学习使用 mini-swe-agent 2.4.6，配置名称为 `anthropic/kimi-for-coding`，实际服务是 Kimi Code。记录的是模型别名，没有固定可核实的底层模型快照。`anthropic/` 用于 LiteLLM 的协议适配，不能据此判断实际服务商。

Kimi Code 与 Moonshot 开放平台的接入需要核对密钥所属产品和接口地址，不能仅凭密钥前缀判断。

## 配置写进文件，命令负责启动

YAML 内容应该保存在文件中，直接粘贴进 zsh 会出现 `command not found: model:`。共用配置类似：

```yaml
model:
  model_class: litellm
  model_name: anthropic/kimi-for-coding
  set_cache_control: null
  cost_tracking: ignore_errors
  model_kwargs:
    api_base: https://api.kimi.com/coding/
agent:
  step_limit: 12
```

凭据单独配置，不写进文章或任务文件。在独立练习目录启动：

```bash
mini \
  -c mini.yaml \
  -c ../kimi-code.yaml \
  -o trajectory.json \
  --exit-immediately \
  -t '只在当前目录创建 hello.py，输出 Hello, mini-SWE-agent，运行验证后提交任务。'
```

第二个配置路径要按自己的目录调整。`mini` 是运行程序，`-c` 只说明本次加载哪些配置，并不会变成“只配置”。后加载的配置覆盖同名字段，下次只输入 `mini` 不会自动记住此前所有参数。

`--exit-immediately` 省去提交后追加任务的询问。跳过逐条执行确认使用另一个参数 `-y`。每任务 12 步指模型请求次数，一次回复可以包含多个动作。

费用计价失败时可能记为 0，因此不能把记录为 0 理解为没有实际额度消耗。

## 第一次为什么显示整段提示词

初始消息包括 system 的角色说明，以及 user 中渲染后的任务与操作说明。交互式 Agent 在添加消息时也打印它们，所以终端会显示这些正文。

`Recommended Workflow` 建议分析、复现、修改、验证和提交；`Command Execution Rules` 约束工具调用；命令示例帮助模型生成适合环境的操作。模板中的 `{{task}}` 和系统信息占位符会在运行时替换。

不同任务会替换任务文字，配置也可以替换固定模板。终端打印的消息正文不等于完整 API 请求：工具定义通过独立的 `tools` 参数发送，模型参数另行处理，后续每轮还会增加新消息；服务端内部处理也无法从这些打印中完整得知。

## 第一次成功任务留下了什么

那次轨迹记录了三次模型调用：

```text
查看目录并创建 hello.py
→ 执行 python3 hello.py
→ 提出完成命令
```

工具观察记录了 `Hello, mini-SWE-agent`，程序返回 0，最终状态为 `Submitted`。验收要同时对照文件、实际输出和结束状态。

完成命令是 Agent 的结束信号，不等于 Git commit。

## 读轨迹先看四处

| 位置 | 看什么 |
| --- | --- |
| info | 版本、配置、统计和结束状态 |
| messages 的直接元素 | 实际消息顺序 |
| assistant.extra.actions | 模型提出的命令 |
| tool 的 raw_output 和 returncode | 执行后真实观察 |

完整 API 响应可能在 extra.response 里重复保存，因此不要在整个 JSON 中数 role 的出现次数来判断对话轮数。


---

{% post_link mini-swe-agent-index "系列目录" %} · {% post_link mini-swe-agent-02-loop "下一篇：从入口追到 Agent 循环" %}
