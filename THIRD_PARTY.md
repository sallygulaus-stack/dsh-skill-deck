# 第三方来源与致谢（THIRD_PARTY）

开发过程中参考过下面两个插件。写在这里是为了把边界说清楚：**其中一个是纯设计参考，
另一个存在代码派生 —— 派生部分连同其版权声明与许可全文见 [NOTICE](NOTICE)。**

## 参考与边界（2026-10-12 词级比对核定）

| 插件 | 作者 | 许可证 | 与本项目的关系 |
| --- | --- | --- | --- |
| [`@linxin666/dsh-client-ui-skill-explorer`](https://github.com/zhu1090093659/dsh-web)（旧「技能中心」） | zhu1090093659 | BSD-3-Clause | **纯设计参考**：技能中心的形态——按来源分组、启停改写 `disable-model-invocation`、回收站、按官方 `dsh-skill-filesystem` 的根约定扫描。**无代码派生** |
| [`@weibaohui/skills-management`](https://github.com/weibaohui/skills-management) | weibaohui | MIT | **有代码派生**（三处，见下），并参考了输入栏「技能」快捷插入的位置与交互、候选拉不到时退回宿主 `/` 菜单这条思路 |

### 一、BSD-3 那个：无代码派生

最长连续相同词串 **12 词**，且是 `for (let i = 0; i < lines.length; i += 1)` 这类通用循环写法；
唯一整行相同的也是它。因此不产生 BSD-3-Clause 的署名义务，列为致谢出于自愿。

### 二、MIT 那个：存在代码派生（已按 MIT 要求随附声明）

| 位置 | 派生内容 |
| --- | --- |
| `client-src/30-picker.js` | `SkillPicker` 组件（输入栏「技能」候选浮层）：组件结构、effect 组织、键盘处理、定位算法 |
| `client-src/20-panel.js` | `ConfirmDialog` 中 Esc 关闭的监听写法 |
| `src/index.js` | `scanSkillDirs` / `scanRoot` / `readSkillEntry` 一带的技能目录扫描辅助 |

MIT 的义务只有一条：**在副本或实质部分中保留版权声明与许可声明**。本仓库的做法是
[NOTICE](NOTICE)（版权行 + MIT 全文），并且：

- `package.json` 的 `files` 已包含 `NOTICE`，所以 npm 包与从仓库安装的副本都会带上它；
- `client/bundle.js` 的头部注释也带一行指向 `NOTICE`（构建产物同样属于「实质部分」）。

### 三、属独立编写的部分

与上游最长连续相同词串 **≤7 词**、参考特有 8 词片段 **0** 的部分：宿主路由族与
provider 注册、本地 `meta.json` 仓库（中文别名/描述/分类/标签、`.bak` 与 `.corrupt-*` 抢救）、
`.md` 导入解析、客户端样式体系与列表 UI、`scripts/` 下的三个冒烟脚本。

### 四、不算任何一方的那类重合：宿主契约

`slash/input-insert-text` 事件名、`captureInsertion()` 返回的 `{ start, end, draftRev }` 形状、
`toggleSource(source, { … })` 的参数名、`ctx.skills.registerProvider(...)` /
`ctx.webServer.register(...)` 的调用形状 —— 这些是 DeepSeek Harness 规定的接口，
任何插件写这条路径都只能长这样，不属于任一插件的表达。

> **比对方法（可复现）**：剥掉注释 → 空白归一 → 按词切分，测两个文件之间的
> 「最长连续相同词串」与「8/10/12 词片段重合」，并用本机 3 个无关插件的 bundle
> 作对照组剔除通用样板。对照组的意义：客户端 bundle 的 loader 外壳（
> `factory: (require) => { var module = { exports: {} } …`）是所有插件共有的 19 词样板，
> 不这么做会把「人人都有」误报成「抄了」。

## 宿主

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：本项目运行于其上，只使用它公开的插件接口；
  本仓库不含宿主代码。
- `react` / `react-dom` 由宿主提供，本项目只做可选引用（`require` 失败也能装载）。

## 依赖

本插件没有运行时依赖（`dependencies` 为空），仓库里也没有任何第三方素材、图标或字体。

## 许可

本项目以 MIT 发布，见 [LICENSE](LICENSE)。本软件包含的第三方派生代码，其版权声明与
许可全文见 [NOTICE](NOTICE)，并随本软件的副本一并分发。
