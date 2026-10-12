# dsh-skill-deck

> DSH 技能牌组：本机技能统一管理 + **纯本地中文别名/描述/分类/标签** + 输入栏「技能」快捷插入 + `.md` 一键导入。

它为三个具体痛点而做，功能上与 `@linxin666/dsh-client-ui-skill-explorer`（旧「技能中心」面板）和
`@weibaohui/skills-management`（输入栏快捷发送）有重叠——开发时参考过这两个插件的做法：
对前者是纯设计参考（无代码派生），对后者有**少量代码派生**（浮层组件与技能目录扫描辅助），
已按 MIT 要求在 [NOTICE](NOTICE) 里随附版权声明与许可全文。来源边界见 [THIRD_PARTY.md](THIRD_PARTY.md)。

---

## 它解决的三件事

### 1. 中文别名与自定义描述：只给你看，AI 永远读不到

技能名和 description 就是 `SKILL.md` 里的 frontmatter，想改成看得懂的中文，就等于改模型读到的东西。
本插件把**展示层**独立出来：

| 数据 | 存放位置 | 模型能看到吗 |
| --- | --- | --- |
| 技能真名 / description / whenToUse / 正文 | `SKILL.md` | **能**（这是技能的实质） |
| 中文别名 / 本地描述 / 分类 / 标签 | `<DSH_HOME>/skill-deck/meta.json` | **不能** |

- 别名只被本插件的界面读取：技能列表里显示 `动画制作`，旁边永远并排显示真名 `animate`。
- 本地元数据**不写进 SKILL.md**、**不注册进 `ctx.skills` 注册表**、**不进模型目录**，
  所以模型既看不到、也不受影响。
- 编辑弹窗把这两块**明确分区**：左边「只给你自己看（AI 看不到）」、右边
  「写给模型看的（会改 SKILL.md）」，避免误改。

实测证明（本项目验收记录）：给 `animate` 加别名 `动画制作` 后，
`~/.dsh/skills` 下 13 个 `SKILL.md` 的 SHA256 **全部一字未变**，
且 `skill` 工具仍能正常按真名 `animate` 加载该技能。

#### 标注的数据安全（两条被真实踩过之后立的规矩）

- **删除技能绝不丢标注**：`POST /delete` 只把技能目录移进回收站，`meta.json` 里那条
  标注原样保留——所以「回收站 → 还原到原位」之后别名/描述/分类会**一起回来**，回收站
  列表也会显示别名，便于辨认是哪一条。真正丢弃标注的时机只有一个：**彻底删除**
  （单条 `trash/purge`，或「清空回收站」）。
  > 早先 `/delete` 里顺手 `delete current.skills[name]`，于是「删除 → 还原」之后别名
  > 凭空消失——这是用户实测发现的；`scripts/smoke-host-routes.js` 第 15 步现在锁住它。
- **「读不出来」不等于「空仓库」**：`meta.json` 存在但解析失败时，插件**拒绝任何写入**
  并报错，同时把原始内容另存为 `meta.json.corrupt-<时间>`。绝不能用空仓库覆盖用户数据。
- **每次写入前备份**上一代到 `meta.json.bak`，误操作还有一次回滚机会。
- 清空全部字段再点「保存本地标注」= 清掉该技能的标注（把字段清空的自然预期）；
  它只写一条空记录，不删除条目本身，空记录会在下次进程启动时被清洗掉。

### 2. 分类：按来源自动分组 + 自定义分类/标签

- **自动分组**：按技能来源分（用户技能库 `~/.dsh/skills`、共享池 `~/.agents/skills`、
  项目 `.dsh/skills` / `.agents/skills`、自定义目录、系统内置、运行时注册）。
- **自定义分类**：自己建分类（可配色）给技能归类，列表顶部按分类筛选。
- **两种分组视图**：工具条上「按来源分组」/「按分类分组」一键切换。
- **标签**：逗号分隔的任意标签，参与搜索。

### 3. 输入栏「技能」：点开即插入，底色跟宿主菜单一致

旧插件的浮层背景直接用 `var(--dsw-specific-menu)`——那是个**半透明**菜单色，盖在会话上会
透出后面的正文，很难看清。本插件的浮层换个做法：

```css
/* 菜单色铺面 + 不透明底色托底 */
background-color: var(--dsw-alias-bg-base, #16161a);
background-image: linear-gradient(var(--sh-surface), var(--sh-surface));
/* --sh-surface: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay, #26262c)) */
```

于是它和「仅可查看 / 工作区内修改 / 完全权限」那类宿主菜单**是同一个颜色**（换主题也跟着换），
又不会透出底下的正文——两个问题一起解决。浮层的底色由测试锁住（`smoke-client.js` 第 20 步）。

浮层里**显示中文别名**（主标题）+ 真实技能名（副标题），但**插入的永远是真实技能名**
`/<name> `（底部常驻一行说明这一点）。所以你看中文挑，AI 收到英文真名。

### 4. 一键导入：把桌面上的 `.md` 直接变成技能

「新建」页顶部有一个导入区：**选择 .md 文件**，或把文件**直接拖进去**。

- 自动读取 frontmatter：`name` → 技能名，`description` → 简介，`whenToUse` → 适用场景，
  `disable-model-invocation` → 模型可见性；frontmatter 之外的正文原样成为技能正文。
- **中文文件名自动变成中文别名**（只给你自己看），技能名仍是合法的 kebab-case，
  例如 `Skill-ComfyUI图片反推.md` → 技能名 `skill-comfyui`、别名 `Skill-ComfyUI图片反推`。
- 缺 `description` 时用正文首个段落顶替；都没有才退回文件名，保证一定能建出来。
- 导入失败（重名、超过 64 KB、名字不合法）**不吞错**：把解析结果回填到页面表单，
  改好点「创建技能」即可，文件内容不会白读一次。

#### 插入用的是官方 `InputActions`（一个踩过的坑）

会话作用域槽位（`conversation.input.left`）的标准 prop 里有：

```
inputActions: InputActions      // captureInsertion() + insertText(text, span)
sessionId: SessionId
```

**`input` 不是标准 prop**。`insertText` 的落笔条件是
`span.draftRev === 当前 rev`（见 `ui-conversation` 的 `InputActions`），
而 `span` 必须来自 `captureInsertion()`——它是唯一能拿到正确 rev 的入口。

早期只走 `slash/input-insert-text` 事件（自己拼一个 `{start, end, draftRev: 0}`），
结果是 CAS 静默拒绝：**草稿里什么都出现不了，也不报错**。
现在两条路都留着，官方通道优先，事件通道仅作老内核回退；两条都失败时浮层会明确
提示「没能写进输入框，请手动输入 /技能名」，不再静默吞掉。

---

## 功能一览

| 面板 tab | 能力 |
| --- | --- |
| **技能** | 搜索（别名/真名/描述/标签/分类）、按来源或分类分组、分类筛选、模型可调用开关（改写 `disable-model-invocation`）、编辑、删除（移入回收站） |
| **新建** | 一键导入 `.md`（读取 frontmatter，中文文件名转为中文别名）；或填表建到用户库 / 当前项目 |
| **回收站** | 查看/还原到原位/彻底删除/清空（默认保留 30 天，还原时本地标注一起回来） |

另外：面板顶部「管理分类」可新建/改名/删除分类。

## 模型侧不受影响

本插件在 `ctx.skills` 上注册了一个文件系统技能 provider（`skill-deck-filesystem`），
按官方 `dsh-skill-filesystem` 的根约定扫描技能。这是有意为之：本 profile 里官方
filesystem provider 与 `@weibaohui/skills-management`（它的 provider 名是 `ntd-skills`）
都被停用，如果本插件不顶上，模型侧就**一个技能都看不到**。

provider 只输出技能的**真实**字段；本地别名/描述/分类完全不在其中
（有离线测试专门断言候选里绝不出现别名）。

---

## 安装

```powershell
# 把插件目录放到任意位置，然后把它装进目标 profile：
dsh plugin --profile desktop add link:<插件目录的绝对路径>

# 例如：
dsh plugin --profile desktop add link:D:\plugins\dsh-skill-deck
```

也可以先用插件管理器 UI（设置 → 插件）从本地目录安装。

`package.json` 已按**可发布/可分发**形态写好：无 `private`、带 `keywords` / `files` / `LICENSE`，
也可以直接发布到 npm 后 `dsh plugin --profile desktop add dsh-skill-deck`。

> **首次安装或升级后请「完全退出 DSH（含托盘）再启动」**，原因见下：

- 宿主半区的代码改动（`src/index.js`）**必须重启进程**才能生效——Node 的 `require` 缓存不会
  因为插件行重新挂载而失效。
- 客户端半区的 bundle 改动：重新 `node scripts/build-client.mjs` 后，页面刷新即可。

## 开发

```powershell
node scripts/build-client.mjs     # 拼接 client-src/*.js → client/bundle.js
node scripts/smoke-host.js        # 宿主纯函数冒烟（frontmatter 解析/外科式改写/仓库清洗）
node scripts/smoke-host-routes.js # 宿主路由端到端（临时 DSH_HOME，不碰真实技能）
node scripts/smoke-client.js      # 客户端 bundle 装载 + 组件渲染覆盖
```

`client-src/` 的分片按文件名顺序拼接，共享同一个 `factory` 作用域：

| 分片 | 内容 |
| --- | --- |
| `00-head.js` | `__ModuleLoader__` 包装、常量、样式表、`ensureStyles` |
| `10-core.js` | 路由探活与 fetch、小工具、基础组件 |
| `20-panel.js` | 「技能牌组」中栏页面（列表/分组/编辑/分类/新建导入/回收站） |
| `30-picker.js` | 输入栏「技能」按钮 + 快捷插入浮层 + `slash/input-insert-text` 插入 |
| `99-tail.js` | `apply`/`inject` 导出与槽位注册 |

## 配置

profile 的 `cordis.patch.yml` 里可以写：

```yaml
- id: skill-deck
  name: dsh-skill-deck
  config:
    customSkillDirs: []        # 额外扫描的技能根目录
    dataDir: ~/.dsh/skill-deck  # 本地元数据 + 回收站 + 诊断产物的落盘目录
    trashRetentionDays: 30     # 回收站保留天数，<=0 关闭自动清理
    providerName: skill-deck-filesystem
    dumpClientGraph: true      # 启动时把客户端模块图写到 dataDir/client-graph.json
```

## 对外路由

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `api/dsh-skill-deck/list` | GET | 分组技能列表 + 本地元数据 + 分类（可带 `?cwd=`） |
| `api/dsh-skill-deck/picker` | GET | 快捷插入浮层的候选（小投影） |
| `api/dsh-skill-deck/read` | GET | 单个技能的可编辑字段与正文（`?name=&path=`） |
| `api/dsh-skill-deck/meta` | POST | 保存本地标注（别名/描述/分类/标签）——**只写 meta.json** |
| `api/dsh-skill-deck/categories` | POST | 分类 create/update/delete |
| `api/dsh-skill-deck/set-enabled` | POST | 切换 `disable-model-invocation`（外科式改写 frontmatter） |
| `api/dsh-skill-deck/create` / `update` / `delete` | POST | 创建 / 就地改写 / 移入回收站 |
| `api/dsh-skill-deck/trash` / `trash/restore` / `trash/purge` | GET/POST | 回收站 |
| `api/dsh-skill-deck/health` / `client-graph` | GET | 健康检查 / 客户端模块图诊断 |

所有路由先过 `ctx.connection.requestRejection` 的信任栅栏；写路由还会把「面板显示的路径」
当身份声明，执行前必须由一次**全新扫描**解析出同名且路径完全一致的技能，否则拒绝
（防止项目技能消失后改到同名的用户级技能）。

## 已知限制

- `SKILL.md` 的 frontmatter 用零依赖轻量解析（块标量、布尔、嵌套块）；改动用**外科式替换**
  ——只替换自己那几个键的行区间，注释、`input:` 嵌套块、其余键原样保留。生僻 YAML 特性
  以官方 provider 的解析为准。
- 链接（符号链接）技能可列出、可切换模型可见性，但**不可编辑、不可删除**（会越出当前技能根）。
- 宿主代码改动必须重启 DSH 进程才生效（见「安装」）。
- **删除确认用面板自带的 `ConfirmDialog`，不用原生 `confirm()`**。DSH Desktop 的 GUI 走
  `dsh-app://` 自定义协议，实测原生确认框**不弹窗**（枚举全系统窗口——含不可见窗口——查不到
  任何对话框），因此用原生确认时「删除」会**静默什么都不做**。`scripts/smoke-client.js` 里
  有一条护栏：客户端 bundle 中一旦再出现原生确认调用，测试立刻失败。
- 同理，DSH Desktop 的渲染器在本机自动化下表现异常（`window.confirm` 不弹、部分表单字段
  收不到注入的键盘/粘贴事件），排查界面问题时别把「注入无效」当成「功能无效」。

---

## 来源与致谢

开发时参考过的两个插件、它们与本项目重合/不重合的边界、以及宿主接口的归属，
见 [THIRD_PARTY.md](THIRD_PARTY.md)。
