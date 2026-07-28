# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run server    # local dev server at http://localhost:4000 (live reload)
npm run build     # generate static files into public/
npm run clean     # clear generated files and cache (db.json, public/)
npm run deploy    # deploy to configured remote (type unset by default)
```

No test suite exists for this project.

## Architecture

This is a **Hexo 8** static blog ("Francis' Olio") that generates a Chinese/Japanese-language personal site.

**Configuration split:**
- `_config.yml` — global Hexo config: site metadata, permalink format (`:year/:month/:day/:title/`), pagination (10/page), syntax highlighting, deployment target
- `_config.Francis.yml` — theme-specific config: menu, swiper image, about-page content, footer, GSAP animation toggles

**Theme:** Francis (located in `themes/Francis/`). EJS templates live in `themes/Francis/layout/`. The theme has its own `_config.yml` inside the theme folder; the site-level `_config.Francis.yml` overrides it per Hexo's theme config merging convention.

**Content:**
- Posts go in `source/_posts/` as Markdown with frontmatter (`title`, `date`, `categories`, `tags`)
- Static pages: `source/about/`, `source/archive/`, `source/tag/`, `source/tag-detail/`
- Post scaffold is at `scaffolds/post.md`

**Scaffold frontmatter for new posts:**
```yaml
---
title: 
date: 
tags:
  - 
categories:
  - 
---
```

Use `hexo new "Post Title"` to create a new post from the scaffold.
