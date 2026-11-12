---
layout: post
title: "mini-SWE-agent 学习系列：从跑通任务到追踪机制"
date: 2026-11-05 12:01:00
slug: mini-swe-agent-index
tags:
  - mini-SWE-agent
  - Python
  - AI Agent
categories:
  - 技术学习
---

我的目标是：想修改一个 Agent 功能时，知道应该从哪里下手。实际学习从跑通任务开始，经历阅读轨迹、追主循环、制造失败，再到增加运行摘要、批量入口和独立测评。

<!-- more -->

## 阅读顺序

1. {% post_link mini-swe-agent-01-start "第一次运行与提示词" %}
2. {% post_link mini-swe-agent-02-loop "从入口追到 Agent 循环" %}
3. {% post_link mini-swe-agent-03-messages "模型接口与消息历史" %}
4. {% post_link mini-swe-agent-04-environment "命令执行、返回码与超时" %}
5. {% post_link mini-swe-agent-05-prompts "只改一项提示词的对照实验" %}
6. {% post_link mini-swe-agent-06-failures "区分环境、模型与任务问题" %}
7. {% post_link mini-swe-agent-07-batch "运行摘要与批量任务" %}
8. {% post_link mini-swe-agent-08-evaluation "建立八项任务的小型测评集" %}
9. {% post_link mini-swe-agent-09-pipefail "为什么测试失败，返回码却是零" %}

## 学习中的转折

一开始不断跑成功、失败和超时任务，我觉得自己像个测试员：能看到现象，却没有逐渐掌握项目的感觉。后来明确，每个实验都应回答源码问题：谁调用谁、输入是什么、结果保存在哪里，如果改一个行为该动哪一层。

**Model 提动作，Environment 执行，Agent 管循环。**

沿着这条主线，还会遇到项目之外的知识。比如 pytest 失败却返回 0，需要补 Shell 的管道规则；不是把 Python 文件多读几遍就能凭空知道 pipefail。

## 范围与结果

- 使用 mini-swe-agent 2.4.6、本地执行环境和交互式 Agent。
- 模型配置名为 anthropic/kimi-for-coding，未固定可核实的底层模型快照。
- 摘要功能已实现；批量和测评脚本已在本地练习中运行。
- 本轮八项任务全部通过独立检查，不代表所有可能输入都正确。
- pipefail 已完成默认管道实验和手册阅读，项目接入尚未实现。

文章按知识主题编排，序号不等于原练习天数。文中标为本地记录的轨迹、脚本和运行材料没有随文章公开；源码引用指向可访问的个人仓库版本。路径示例中的 `/path/to/mini-swe-agent` 需要自行替换。

## 项目与个人改动

- [上游项目](https://github.com/SWE-agent/mini-swe-agent)。
- [个人学习仓库](https://github.com/Ubi-olio/mini-swe-agent)。
- [运行摘要功能提交](https://github.com/Ubi-olio/mini-swe-agent/commit/99b1836c)。

整理日期：2026-11-05。
