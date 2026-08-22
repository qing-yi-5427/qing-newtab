# Edge 新标签页 · 前端视觉与交互优化规格（UI/UX Optimization Spec）

> **文档角色**：本规格是工程师实现前端视觉/交互改造的依据。它**只给规格、不给实现代码**。
> **对齐前提**：
> - 与架构师《optimization-plan.md》硬性对齐（削减叠加模糊、缓存、时钟对齐暂停、reduced-motion/focus/ARIA、存储迁移、esbuild 仅压缩、裁剪精简）——见 §0。
> - 遵守 7 项已锁定决策（见 §0.2）。
> - 现状基线已通读 `newtab.html`(99) / `newtab.css`(373) / `newtab.js`(425) / `manifest.json`。
>
> **设计基调**：从「毛玻璃重叠加」转向「半透明克制 + 系统字体 + 双主题可控 + 零网络图标」，在维持纯原生（无运行时框架）前提下提升简洁/高效/快速/低占用/美观。

---

## 0. 对齐约束（必须无条件遵守）

### 0.1 来自 optimization-plan.md 的硬性约束
| 约束 | 落地要求 |
|------|----------|
| 削减 `backdrop-filter: blur()` 叠加 | 快捷方式卡片**去掉 blur**，改半透明纯色；搜索框/标签栏 blur 降到 **4–6px**；overlay 去 blur 或仅 **0.5px**；弹窗 blur 降到 **2–3px**。视觉从「毛玻璃」转「半透明克制」。 |
| 动效可关闭 | 所有动画/过渡必须可被 `@media (prefers-reduced-motion: reduce)` 关闭；加 `:focus-visible` 焦点环；tab 加 ARIA。 |
| 时钟 | 对齐到**分钟**；页面隐藏（`visibilitychange`）时**暂停**。 |
| 拖拽 | 已用 `transform/opacity`（合成属性），**保留**，不回退到重排。 |
| 框架 | **不引入**任何运行时框架；esbuild 仅做拼接压缩，产物单文件、零运行时。 |

### 0.2 已锁定决策（写进规格，不可违背）
1. **图标裁剪保留但简化**：直接传方形图 + CSS 圆角/遮罩 + 缩放预览，**去除 canvas 裁剪**（删 `crop-modal`、`crop-*` 逻辑）。
2. **壁纸允许联网**拉 Bing 每日图，按日期缓存到 `chrome.storage.local`，离线/失败用本地渐变兜底。
3. **加明暗手动切换**：跟随系统 / 明 / 暗 三种模式。
4. **搜索引擎可切换**：Bing / Google / 自定义。
5. **快捷方式图标默认字母头像**（内联 SVG/纯 CSS，零网络）；可选「开联网 favicon 并缓存」。
6. **引入 esbuild 仅压缩拼接**：开发拆 `src/*` 多模块，发布产出单文件 `newtab.js`，零运行时框架。
7. **存储从 `localStorage` 迁到 `chrome.storage.local`**。

### 0.3 现状问题 → 本文档对策映射
| 现状隐患（来自架构师评估） | 本文档对策章节 |
|----------------------------|----------------|
| 每张卡片 blur(8px) 叠加 | §3.1 配色/§4.3 卡片去掉 blur |
| 壁纸每次 fetch 无缓存 | §4.7 壁纸切换控件 + §8 实现（wallpaper.js） |
| favicon 走 google 外链 | §4.3 字母头像 + §8（favicon.js） |
| 时钟 10s 重绘 + 隐藏不停 | §4.1 时钟 + §8（clock.js） |
| 单文件 425 行 | §8 模块拆分（src/*） |
| 无障碍缺失 | §7 全章 + §4.2/§4.5 ARIA |
| base64 图标存 localStorage | §8 存储迁移 + 图标上传限尺寸 |

---

## 1. 设计原则与目标映射（5 诉求 → 前端落地）

| # | 诉求 | 前端层落地做法（1–2 句） |
|---|------|---------------------------|
| ① | **简洁** | 削减毛玻璃、统一设计令牌（颜色/间距/圆角一套变量）；去除 canvas 裁剪交互；设置项分层（偏好 + 快捷方式管理）。视觉噪音降到最低。 |
| ② | **高效** | 键盘优先：`/` 聚焦搜索、`Esc` 关弹窗、Tab 方向键切换；时钟隐藏即暂停；书签树仍懒加载；所有交互即时无等待态。 |
| ③ | **快速** | 壁纸按日期**缓存优先**首屏即出图；字母头像**零网络**即时渲染；单文件压缩 JS、无框架引导开销；首屏图标不 lazy（在视口内）。 |
| ④ | **低占用** | 去掉每卡片 blur 合成层；favicon/字体零外链请求；无运行时框架、无常驻 reconciler；单文件最小体积。 |
| ⑤ | **美观** | 双主题手动可控 + WCAG AA 对比度；统一间距/圆角阶梯；入场 stagger 动效克制优雅； refined 排版（时钟 tabular-nums、字距）。 |

> 设计语言一句话：**「克制的半透明 + 系统字体的精致排版 + 零网络图标 + 可控双主题」**。

---

## 2. 布局与信息架构

### 2.1 现状评估
当前结构「垂直居中单列：时钟 → 搜索 → 书签 Tab（快捷方式网格 / 书签树）」**方向正确**，无需重构为双栏或侧栏。需优化的是：**留白节奏、对齐一致性、内容容器 max-width、三档断点的列数/字号收敛**。

### 2.2 布局草图（桌面 ≥1024px）

```
┌──────────────────────────────────────────────────────────┐
│                    [ 壁纸 + overlay + 局部 scrim ]          │
│                                                            │
│                      ┌────────────────┐                    │
│                      │     12:34      │   ← 时钟 96px / wt200 / 收紧字距
│                      │   Tue 7/15     │   ← 日期 16px / 次色
│                      └────────────────┘                    │
│                            ↕ 32px                          │
│                   ┌────────────────────────┐               │
│                   │  🔍 Search…      [B]  │  ← 搜索框 max 560 / 胶囊 / 右侧引擎切换[B]
│                   └────────────────────────┘               │
│                            ↕ 40px                          │
│          [ Shortcuts ] [ Bookmarks ]          ⚙  ← Tab栏(max内) + 设置
│                            ↕ 24px                          │
│   ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐         │
│   │ G  ││ Y  ││ X  ││ R  ││ Z  ││ B  ││ +  ││ .. │  ← 网格 cols=8
│   └────┘└────┘└────┘└────┘└────┘└────┘└────┘└────┘         │
│                                                            │
└──────────────────────────────────────────────────────────┘
        整体内容容器 max-width ≈ 720px，水平居中
```

**书签 Tab 激活时**（替换网格区）：
```
│          [ Shortcuts ] [ Bookmarks ]          ⚙  │
│   ┌──────────────────────────────────────────┐   │
│   │ ▸ Bookmarks bar              (12)         │   │ ← 文件夹（手风琴）
│   │   🔗 GitHub          github.com          │   │
│   │   🔗 YouTube         youtube.com         │   │
│   └──────────────────────────────────────────┘   │
```

### 2.3 布局参数建议
| 参数 | 建议值 | 说明 |
|------|--------|------|
| 整体内容容器 | `max-width: 720px`，水平居中 | 时钟/搜索/Tab 均在此容器内，保证对齐一致 |
| 垂直分布 | flex column，`justify-content: center` + `translateY(-4%)` 轻微上移 | 比现 `-5%` 略收，避免时钟过顶 |
| 区块间距 | 时钟→搜索 **32px**；搜索→Tab栏 **40px**；Tab栏→面板 **24px** | 用间距令牌（见 §3.3） |
| 搜索框 | `max-width: 560px`，`width:100%` | 保持胶囊形 |
| Tab 区 | 与搜索框**左对齐同宽**（容器内），非绝对居中 | 视觉锚定更稳 |
| 网格 | `grid-template-columns: repeat(var(--cols), var(--cell))`，`--cell:72px`，`--gap:12px` | 沿用现 `--cols` 逻辑 |

### 2.4 三档断点布局差异（见 §6 详表）
- **桌面 ≥1024px**：`--cols:8`，时钟 96px，搜索 560px，书签 720px。
- **平板 700–1023px**：`--cols:6`，时钟 80px，搜索 90vw(≤560)，书签 95vw(≤720)；Tab 栏与容器同宽。
- **移动 ≤699px**：`--cols:4`，时钟 64px，`--cell:64px`，搜索 92vw，书签 94vw，设置弹窗 95vw；Tab 文字可省略仅留图标。

---

## 3. 视觉系统（设计令牌 Design Tokens）

> 全部以 CSS 变量表达，便于主题切换与维护。分**暗（默认）/ 明 / 跟随系统**三态。
> 主题机制：`[data-theme="dark"]` / `[data-theme="light"]` 显式覆盖；无 `data-theme` 时按 `@media (prefers-color-scheme)` 跟随系统（见 §3.4）。

### 3.1 配色令牌（建议值，目标 WCAG AA）

**暗色（默认）**
```css
--text-primary:   #ffffff;
--text-secondary: rgba(255,255,255,0.78);   /* 小字需 AA，调高透明度 */
--bg-search:      rgba(255,255,255,0.10);   /* 纯半透明，无 blur（搜索框仍保留 5px） */
--bg-search-focus:rgba(255,255,255,0.18);
--border-search:  rgba(255,255,255,0.24);
--bg-card:        rgba(255,255,255,0.08);   /* 卡片：去 blur，纯半透明 */
--bg-card-hover:  rgba(255,255,255,0.16);
--overlay-bg:     rgba(0,0,0,0.50);          /* 由 0.35 加深，保障对比度 */
--modal-bg:       rgba(28,28,32,0.94);
--modal-text:     #ececed;
--modal-border:   rgba(255,255,255,0.12);
--btn-primary:    #2563eb;                   /* 白字 AA 通过 */
--btn-primary-hover:#1d4ed8;
--accent:         #60a5fa;                   /* 焦点环/拖拽边 */
--shadow:         0 2px 16px rgba(0,0,0,0.35);
--focus-ring:     0 0 0 3px rgba(96,165,250,0.55);
--scrim:          linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 100%); /* 内容区局部遮罩，保对比度 */
```

**明色**
```css
--text-primary:   #1a1a1a;
--text-secondary: rgba(0,0,0,0.62);
--bg-search:      rgba(255,255,255,0.65);
--bg-search-focus:rgba(255,255,255,0.90);
--border-search:  rgba(0,0,0,0.14);
--bg-card:        rgba(255,255,255,0.55);
--bg-card-hover:  rgba(255,255,255,0.82);
--overlay-bg:     rgba(255,255,255,0.30);
--modal-bg:       rgba(255,255,255,0.96);
--modal-text:     #2b2b2b;
--modal-border:   rgba(0,0,0,0.10);
--btn-primary:    #2563eb;
--btn-primary-hover:#1d4ed8;
--accent:         #2563eb;
--shadow:         0 2px 16px rgba(0,0,0,0.14);
--focus-ring:     0 0 0 3px rgba(37,99,235,0.45);
--scrim:          linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.30) 100%);
```

**对比度达标策略（硬约束）**
- 暗色时钟/文字为白，依赖 `--overlay-bg:0.50` + `--scrim` 局部遮罩 + `text-shadow` 三重保障，确保任意亮壁纸下仍 ≥ AA（小字 4.5:1、大字 3:1）。
- 明色文字为深，依赖浅 overlay + scrim。
- 若用户壁纸极亮且关 scrim 仍不达标，作为降级兜底：卡片/搜索框背景透明度再 +0.05（见 §8 风险 R1）。

### 3.2 字体与排版规范
| 元素 | 字号 | 字重 | 字距 | 其他 |
|------|------|------|------|------|
| 时钟 `#time` | 96 / 80 / 64（三档） | 200 | -2px | `font-variant-numeric: tabular-nums`（防抖动）；`text-shadow` 保对比 |
| 日期 `#date` | 16 / 14 | 400 | 0.5px | 次色；`margin-top:8px` |
| 搜索输入 | 15px | 400 | — | placeholder 次色 |
| Tab 按钮 | 13px | 500 | — | 激活态主色 |
| 卡片名 `.shortcut-name` | 11px（1x1）/ 12–13px（2x2） | 500 | — | 次色；`text-overflow:ellipsis` |
| 字母头像字母 | 18 / 22 / 28（按尺寸） | 600 | — | 白字 |
| 书签文件夹名 | 13px | 600 | 0.3px | 次色 |
| 书签链接标题 | 13px | 500 | — | 主色 |
| 书签链接 URL | 11px | 400 | — | 次色（0.7） |
| 弹窗标题 h3 | 18px | 600 | — | |
| 设置项名 | 13px | 600 | — | |
| 全局字体族 | 系统栈：`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | | | 沿用，零网络字体 |

### 3.3 间距与圆角阶梯（统一令牌）
**间距阶梯**：`--space-1:4px / --space-2:8px / --space-3:12px / --space-4:16px / --space-5:24px / --space-6:32px / --space-7:40px`
- 卡片内 padding：`--space-3`（12px 8px）；区块间距用 `--space-5/6/7`（见 §2.3）。

**圆角阶梯**：
| 令牌 | 值 | 用于 |
|------|----|------|
| `--radius-xs` | 6px | 滚动条、小控件 |
| `--radius-sm` | 8px | Tab 按钮、书签行、尺寸 chip、输入 |
| `--radius-md` | 12px | Tab 栏容器、设置项、图标包裹 |
| `--radius-lg` | 16px | 快捷方式卡片、弹窗 |
| `--radius-pill` | 999px | 搜索框、圆形按钮 |

> 现状卡片 14px → 统一为 16px（`--radius-lg`）；搜索框维持胶囊。

---

## 4. 组件打磨清单（逐个：现状 → 目标 → 具体改法）

> 标注：🔷=视觉　🔶=交互

### 4.1 时钟区 🔷🔶
- **现状**：96px/wt200/`text-shadow:0 2px 8px`；`setInterval(10s)` 隐藏不停。
- **目标**：对齐分钟 + 隐藏暂停 + 排版防抖。
- **改法**：
  - 加 `font-variant-numeric: tabular-nums` 防宽度抖动。
  - 日期字距 0.5px、次色。
  - JS（clock.js）：计算到下一分钟对齐定时器；`visibilitychange` 隐藏 `clearInterval`、可见重启并即时校正（对应 O4）。

### 4.2 搜索框 🔷🔶
- **现状**：`blur(12px)` 胶囊，max 560；硬编码 Bing 提交。
- **目标**：blur 降到 5px、加焦点环、可切引擎。
- **改法**：
  - 🔷 `backdrop-filter: blur(5px)`；背景透明度略升（0.10）补偿少 blur；`border-search` 0.24；聚焦加 `box-shadow: var(--focus-ring)`。
  - 🔶 输入框**右侧加引擎切换控件**（小按钮显示当前引擎图标/字母 B/G/✎，点击展开 Bing/Google/自定义）。提交按当前引擎拼 URL（自定义用 `%s` 模板）。
  - 🔶 保留 `/` 聚焦；加 `aria-label="Search"`（已有 svg 按钮）。

### 4.3 Tab 栏 + 快捷方式卡片 🔷🔶
- **Tab 栏现状**：`blur(8px)`，两按钮 + 设置齿轮；无 ARIA。
- **Tab 栏改法**：🔷 blur→5px；🔶 `#tab-bar` 加 `role="tablist"`，`.tab-btn` 加 `role="tab"` + `aria-selected` + `aria-controls`；方向键 ←/→ 切换 + `Enter/Space` 激活；激活指示保留背景高亮。
- **快捷方式卡片现状**：每张 `blur(8px)`（最大 GPU 开销）；favicon 外链。
- **卡片改法**：
  - 🔷 **去掉 blur**，改 `--bg-card` 纯半透明；圆角 16px；hover `translateY(-2px)` 保留（0.18s ease）；`:focus-visible` 加焦点环。
  - 🔷 **字母头像**（默认）：圆形（`--radius-sm` 或 8px）底色由 name 哈希确定（从一组 AA 友好的强调色取），居中显示首字母大写、白字、wt600。尺寸随卡片：1x1≈18px 字/40px 圆；2x1≈20px/48px；2x2≈28px/64px。
  - 🔶 4 种尺寸（1x1/1x2/2x1/2x2）保留；拖拽保留 `transform/opacity` 合成属性 + `drag-over` 用 `--accent` 边。
  - 🔶 图标策略：默认字母头像（零网络）；设置里可开「联网 favicon 并缓存」（对应决策 5 / O3）。

### 4.4 书签树 🔷🔶
- **现状**：文件夹手风琴；favicon 外链 lazy。
- **改法**：🔷 保持现有卡片式行样式（本无 blur）；🔶 favicon 默认改字母头像、可选缓存（同 §4.3）；🔶 文件夹头/链接加 `:focus-visible`；保留懒加载与 `loading="lazy"`（深层图标）。

### 4.5 设置弹窗 🔷🔶
- **现状**：520px、`blur(4px)`、「Manage Shortcuts」仅管理快捷方式。
- **目标**：blur→2–3px；新增「偏好」分区（主题/壁纸/引擎/图标模式）。
- **改法**：
  - 🔷 `backdrop-filter: blur(3px)`；宽度响应式（桌面 520 / 移动 95vw）；圆角 16px。
  - 🔶 加 `role="dialog" aria-modal="true" aria-labelledby`；打开时焦点移入、关闭回落触发按钮；`Esc` 关闭（已有）。
  - 🔶 **新增「Preferences」区**（置于快捷方式列表上方）：
    - 主题：三段式（跟随/明/暗）`segmented control` → 写 `data-theme`。
    - 壁纸：开关 toggle（开=联网 Bing 缓存；关=纯本地渐变）。
    - 搜索引擎：select（Bing/Google/自定义），自定义显 URL 模板输入（`https://...?q=%s`）。
    - 图标模式：radio（字母头像 / 联网 favicon 并缓存）。
  - 🔶 保留快捷方式管理（增删、尺寸 chip、拖拽排序、图标上传）。

### 4.6 图标上传（简化版，去 canvas）🔷🔶
- **现状**：`crop-modal` + `<canvas>` + zoom 滑块做交互裁剪。
- **目标**：直接传方形图 + CSS 圆角/遮罩 + 缩放预览，去除 canvas 裁剪。
- **改法**：
  - 🔷 删除 `crop-modal` 与 `<canvas>`；新增「图标预览弹层」：方形 `overflow:hidden` 容器（遮罩 `object-fit:cover` + `border-radius:12px`），内含 `<img>` 用 `transform: scale(zoom)` 做**预览缩放**（非裁剪）。
  - 🔶 流程：点图标 → `file input` → `FileReader` 读为 DataURL → 预览框显示原图 + zoom 滑块调 `transform:scale` → 「应用」存入 `chrome.storage.local`；「取消」丢弃。
  - 🔶 **存储卫生**：上传即校验尺寸/体积（如拒绝 >256KB 或给出提示）；是否做一次非交互降采样（单 `drawImage` 缩到 64/128px）以控 quota —— **见 §8 风险 R3，需确认**（决策 1 说「去除 canvas 裁剪」，单帧降采样不冲突但需拍板）。

### 4.7 主题 / 壁纸 / 搜索引擎 切换控件 🔷🔶
- **主题**（决策 3）：设置内三段式 → JS 设 `<html data-theme>`；无属性=跟随系统。
- **壁纸**（决策 2）：开关；关→纯本地渐变（去 Bing 请求）；开→按日期缓存（见 §8 wallpaper.js）。
- **搜索引擎**（决策 4）：Bing/Google/自定义；自定义存 URL 模板；搜索提交据此拼装。

---

## 5. 动效与过渡

| 动效 | 曲线 / 时长 | 说明 |
|------|-------------|------|
| **入场 stagger** | `ease-out cubic-bezier(0.16,1,0.3,1)`，0.3s | 时钟 0ms → 搜索 80ms → Tab栏 160ms → 卡片从 240ms 起每张 +24ms（opacity 0→1, translateY 8px→0） |
| **hover** | 0.18s ease | 卡片 `translateY(-2px)`；按钮色变 0.2s |
| **Tab 切换** | 0.25s ease | 面板 `panelIn`（fade+translateY 6px→0）；激活指示过渡 |
| **弹窗** | 0.2s | 背景 fade + 内容 `scale(0.98→1)` |
| **壁纸淡入** | 1s ease | `fadeIn`（首屏用缓存图则省略，仅新拉取时） |
| **焦点环** | 0.15s | `:focus-visible` box-shadow 出现 |

**`prefers-reduced-motion` 降级（硬约束）**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
  /* 入场位移改为无位移直接显隐 */
  #time, #search-section, #toolbar-row, .shortcut-item { transform: none !important; }
  #wallpaper.loaded { animation: none !important; opacity: 1 !important; }
}
```

---

## 6. 响应式（三档断点）

> 沿用现有 `--cols` 逻辑，扩展为三档。字号/列数见下。

| 断点 | `--cols` | `--cell` | 时钟 | 搜索 max | 书签 max | 弹窗 | 备注 |
|------|----------|----------|------|----------|----------|------|------|
| 桌面 ≥1024 | 8 | 72px | 96px | 560px | 720px | 520px | 基准布局 |
| 平板 700–1023 | 6 | 72px | 80px | 90vw(≤560) | 95vw(≤720) | 90vw(≤520) | Tab 与容器同宽 |
| 移动 ≤699 | 4 | 64px | 64px | 92vw | 94vw | 95vw | Tab 文字可隐仅留图标；`--gap:10px` |

- 网格宽度自检：桌面 8×72 + 7×12 = 660px ≤ 720 容器 ✅；移动 4×64 + 3×10 = 286px ✅。
- 时钟字号三档（96/80/64）与 §3.2 一致。
- 移动端设置弹窗接近全宽，内部列表可滚动（`max-height:80vh`）。

---

## 7. 可访问性（A11y）

| 维度 | 规格 |
|------|------|
| **ARIA** | `#tab-bar` `role="tablist"`；`.tab-btn` `role="tab"` + `aria-selected` + `aria-controls="tab-shortcuts|tab-bookmarks"`；面板 `role="tabpanel"` + `aria-labelledby`；设置弹窗 `role="dialog" aria-modal="true" aria-labelledby`；搜索按钮 `aria-label`；图标 `alt`。 |
| **焦点可见** | 全局 `:focus-visible { outline:none; box-shadow: var(--focus-ring); }`，覆盖按钮/输入/chip/卡片/链接。 |
| **reduced-motion** | 见 §5 降级块（硬约束）。 |
| **对比度** | 见 §3.1 三重保障（overlay 0.50 + scrim + text-shadow），目标 AA。 |
| **键盘可达** | `/` 聚焦搜索；`Esc` 关弹窗；Tab 方向键切换 + Enter/Space 激活；所有交互（设置齿轮、尺寸 chip、删除、图标上传、引擎切换）可 Tab 到达并有可见焦点；弹窗打开焦点陷阱、关闭回退。 |
| **lang / meta** | `<html lang="en">`（UI 主文本为英文，修正现 zh-CN 不匹配）；加 `<meta name="theme-color">` 与 `<meta name="color-scheme">` 让地址栏随主题。 |

---

## 8. 与实现衔接

### 8.1 前端改动清单（按文件，标注视觉/交互）

**`manifest.json`** 🔶
- 增 `"storage"` 权限（壁纸/图标/设置缓存，决策 7 / O7）。
- `host_permissions` 保留 `bing.com`（壁纸仍联网）；若壁纸开关可关，允许后续条件移除（O10）。

**`newtab.html`** 🔷🔶
- 加 `<meta name="theme-color">`、`<meta name="color-scheme">`；`<html lang="en">`。
- `#tab-bar` 加 `role="tablist"`；`.tab-btn` 加 `role="tab" aria-selected aria-controls`；面板加 `role="tabpanel" aria-labelledby`（§7）。
- 搜索框内加**引擎切换控件**节点（§4.2）。
- 设置弹窗加 `role="dialog" aria-modal aria-labelledby"`，新增「Preferences」分区（主题/壁纸/引擎/图标模式控件）（§4.5）。
- **删除 `crop-modal` 与 `<canvas>`**，替换为简化「图标预览弹层」（方形遮罩 + zoom 滑块，无 canvas）（§4.6）。
- 主题钩子：`<html>` 由 JS 设 `data-theme`（避免 FOUC，建议内联极简脚本在 `<head>` 早设）。

**`newtab.css`** 🔷
- 设计令牌：暗/明双主题变量 + 跟随系统机制（§3.1）；间距/圆角阶梯（§3.3）。
- 削 blur：卡片去 blur；搜索/Tab栏→5px；overlay→0.5px 或去；弹窗→3px（§0.1 / O1）。
- 排版：`tabular-nums`、字号阶梯、字距（§3.2）。
- `:focus-visible` 焦点环（§7）。
- `prefers-reduced-motion` 降级块（§5）。
- 入场 stagger 动画（§5）。
- 字母头像样式（圆形底色 + 首字母）（§4.3）。
- 三档响应式断点（§6）。
- 局部 scrim 渐变（保对比度）（§3.1）。

**`src/*`（esbuild 拼接 → `newtab.js`）** 🔶（决策 6 / O5）
| 模块 | 职责 | 关键改动 |
|------|------|----------|
| `config.js` | 常量、默认快捷方式、搜索引擎表、主题/图标模式枚举 | 新增引擎表、默认设置 |
| `storage.js` | `chrome.storage.local` 封装（快捷方式/设置/壁纸缓存/图标缓存） | 替代 localStorage（O7）；异步 |
| `clock.js` | 时钟对齐分钟 + `visibilitychange` 暂停 | O4 |
| `search.js` | 提交按引擎拼 URL；引擎切换 UI | 决策 4 |
| `shortcuts.js` | 网格渲染/拖拽（保留 transform/opacity）/尺寸/上传（去 canvas） | 决策 1；O3 字母头像 |
| `bookmarks.js` | 书签树懒加载；字母头像可选 | O3 |
| `wallpaper.js` | 按日期缓存 + 渐变兜底 + 开关 | O2 / 决策 2 |
| `favicon.js` | 字母头像生成 + 可选联网 favicon 缓存 | O3 / 决策 5 |
| `settings.js` | 弹窗/主题(写 data-theme)/壁纸/引擎/图标模式 | 决策 3/4/5 |
| `main.js` | 入口按序初始化（参考架构师附录 B 调用流） | — |

**`build.mjs`** 🔶：esbuild `src/main.js --bundle --minify --outfile=newtab.js`（仅压缩拼接，零运行时）。

**`icons/`**：维持；字母头像为内联，无新增资源。

### 8.2 待工程师确认 / 风险点

| ID | 风险 / 待确认 | 影响 | 建议 |
|----|---------------|------|------|
| **R1** | 任意亮壁纸下暗色文字对比度：scrim/overlay 加深会**压暗壁纸观感** | 美观 vs 可达性 | 提供「遮罩强度」可配（轻/中/强）；默认中档（overlay 0.50 + scrim 0.35） |
| **R2** | 字母头像默认无真实站点图标，用户需接受（决策已锁，但 UX 权衡） | 美观/辨识 | 字母色由域名哈希稳定映射，提升辨识；设置可开 favicon |
| **R3** | 图标上传「去除 canvas」后，原图 base64 可能过大冲击 `chrome.storage.local` quota | 低占用 | 上传即限体积/边长；是否允许**一次非交互降采样**（单 `drawImage` 到 64/128px）需拍板（不冲突决策 1 的「去裁剪」） |
| **R4** | 主题切换 FOUC：页面加载瞬间主题闪一下 | 美观 | `<head>` 内联极小脚本在解析前读 storage 设 `data-theme` |
| **R5** | 引入 esbuild 增加构建步骤 | 简洁/可维护 | 提供 `npm run build`；构建零运行时；CI/发布用产物 `newtab.js` |
| **R6** | `localStorage → chrome.storage.local` 迁移：旧用户数据丢失 | 数据 | 首次启动检测 localStorage 有数据则一次性导入 storage 后清除 |
| **R7** | 自定义搜索引擎需任意 URL 模板：用 `window.location.href` 跳转，**无需** host_permissions；Bing 壁纸仍需 `bing.com` host 权限 | 权限面 | 维持 `bing.com` host 权限；壁纸关时可提示移除 |
| **R8** | 弹窗 blur 2–3px 仍占 GPU；极端低端机 | 低占用 | 若需极致，可降到 0，仅靠半透明 + 阴影 |
| **R9** | 入场 stagger 对 N 个卡片逐张延迟，大量快捷方式时尾部延迟累积 | 快速 | 限制卡片 stagger 上限（如最多 12 张后不再递增延迟） |

---

## 附录 · 与架构师方案的任务对应关系
| 本文档章节 | 架构师方案条目 |
|------------|----------------|
| §0.1 削 blur | O1 / T1 |
| §3.1 壁纸缓存 | O2 / T2 |
| §4.3 字母头像 | O3 / T3 |
| §4.1 时钟对齐暂停 | O4 / T4 |
| §8.1 src/* 拆分 | O5 / T5 |
| §5/§7 动效/焦点/ARIA | O6 / T6 |
| §8.1 存储迁移 | O7 / T7 |
| §4.6 裁剪精简 | O8 / T9 |
| §4.5/§4.7 设置增强 | O9 / T8 |
| §8.2 R7 权限 | O10 / T10 |

> 本规格不改动任何代码，仅定义「做什么 / 长什么样 / 怎么交互」。实现以 `optimization-plan.md` 的架构结论为边界，本文件在其内细化前端视觉与交互。
