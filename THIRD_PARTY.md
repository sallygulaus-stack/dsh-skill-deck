# 第三方来源与致谢（THIRD_PARTY）

本项目为独立实现。开发过程中参考过下面两个插件的**功能与交互**，写在这里是为了把边界说清楚。

## 设计参考

| 插件 | 作者 | 许可证 | 参考了什么 |
| --- | --- | --- | --- |
| [`@linxin666/dsh-client-ui-skill-explorer`](https://github.com/zhu1090093659/dsh-web)（旧「技能中心」） | zhu1090093659 | BSD-3-Clause | 技能中心的形态：按来源分组、启停改写 `disable-model-invocation`、回收站、按官方 `dsh-skill-filesystem` 的根约定扫描 |
| [`@weibaohui/skills-management`](https://github.com/weibaohui/skills-management) | weibaohui | MIT | 输入栏「技能」快捷插入的位置与交互，以及候选拉不到时退回宿主 `/` 菜单这条思路 |

以上都是思路与交互层面的参考。本项目的源码（`src/`、`client-src/`）为独立编写；
与上述项目行文重合的地方，只限于宿主接口本身的固定写法——`slash/input-insert-text` 事件名、
`captureInsertion()` 返回的 `{ start, end, draftRev }` 形状、`toggleSource(source, { … })` 的参数名。
这些是 DeepSeek Harness 规定的契约，任何插件写这条路径都只能长这样，不属于任一插件的表达。

## 宿主

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：本项目运行于其上，只使用它公开的插件接口；
  本仓库不含宿主代码。
- `react` / `react-dom` 由宿主提供，本项目只做可选引用（`require` 失败也能装载）。

## 依赖

本插件没有运行时依赖（`dependencies` 为空），仓库里也没有任何第三方素材、图标或字体。

## 许可

本项目以 MIT 发布，见 [LICENSE](LICENSE)。
