# 博客恢复记录

2026-10-15：从 main 和 gh-pages 恢复本地博客。未推送、未部署。

## 内容

- source/_posts/：四篇正式文章；缺少的两篇从发布网页还原为 Markdown，因此不保证与已丢失的 Markdown 排版逐字一致。
- source/_drafts/rea-first-look.md：REA 试用草稿，正式构建不发布。
- 2026-07-28 日记补回线上版本里已有的一句正文，并恢复生活分类。
- hello-world 保留线上原文章地址，避免日期解析导致链接变化。

## 主题

原主题为 AsukaCC/YoruKumo，目录继续使用 Francis，以沿用 _config.Francis.yml。
主题版本 c9099014e2b2c4bb8f9aaddf06ca8d942e214c5c 与原仓库引用完全一致。
新增 .gitmodules 记录正确主题地址，换电脑时使用：

```sh
git clone --recurse-submodules https://github.com/Ubi-olio/Francis-olio.git
# 已下载但主题为空时：
git submodule update --init --recursive
```

source/css/style.css 保留发布分支中的自定义样式（覆盖主题样式）。
source/js/tasklist.js 和 scripts/restore-tasklist.js 恢复原有待办勾选功能。
source/posts/ 与 source/stats/ 补齐菜单入口。

## 启动与发布

安装 Node.js 和 npm 后，在项目目录执行：

```sh
npm ci
npm run server
npm run build
```

本地地址：http://localhost:4000/Francis-olio/

所有文章、主题地址、页面、样式和脚本都需要一起提交 main 才能在下一台电脑完整还原。
确认本地预览后再部署；不要把草稿移动到 _posts，除非已经准备发布。
