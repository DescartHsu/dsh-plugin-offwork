# dsh-plugin-offwork

下班倒计时 + 今日已赚，两张挂在**侧边栏底部**的统计卡片，for [DeepSeek Harness](https://github.com/deepseek-ai/dsh)。

## 它做什么

| 卡片 | 显示 | 细节 |
|---|---|---|
| 下班还有 | `01:10:25` 式倒计时，每秒刷新 | 右侧 12 根柱子＝今天的工作进度；**17:00 之后同一张卡变「已加班 00:24:31」红字计时**（只计时长，没有加班费率所以不计钱）；非工作日显示「今天不上班」 |
| 今日已赚 | `409.09 ¥`，2 位小数 | 日薪 × 已上班时长 ÷ 工作日总时长，到下班点拿满；右侧标日薪（月薪 ÷ 月工作日） |

样式对齐「今日消耗 Token」那张卡：白底圆角、灰色小标签、大号等宽数字、左侧圆角图标、右侧迷你图。挂在侧边栏 footer，位置在计费卡（若装了）下面、设置按钮上面；侧边栏收起时随 footer 一起隐藏。

## 安装

发布后从 DSH 插件市场装；本机立即用：

```bash
bash offwork-setup/apply.sh      # 装（幂等，首次会快照 package.json）
bash offwork-setup/rollback.sh   # 卸，从快照整份恢复
```

装完**完全退出并重启 DSH Desktop**，卡片出现在侧边栏底部。

## 配置

设置有两处，**优先用第一个，改完 60 秒内生效、不用重启**：

1. **`~/.dsh/offwork.json`**（推荐，改这个文件就行，不用重装）：

```json
{
  "workStart": "09:00",
  "workEnd": "17:00",
  "monthlySalary": 9000,
  "workdaysPerMonth": 22,
  "workdays": [1, 2, 3, 4, 5]
}
```

2. 仓库里的 [`cordis.patch.yml`](cordis.patch.yml) 同名 config（兜底；改它要 `bash offwork-setup/apply.sh` 重装 + 重启 DSH Desktop）。

字段：`workStart`/`workEnd` 上下班时间（24 小时制）；日薪 = `monthlySalary` ÷ `workdaysPerMonth`（不给月薪就直接填 `dailySalary`）；`workdays` 工作日，1=周一 … 7=周日，周六周日不填就是休息。文件里没写的字段沿用下一层的值，写坏了会自动忽略。

**不要直接改 node_modules 里的副本**——会被下一次 apply 覆盖，改动请走 `~/.dsh/offwork.json` 或仓库文件。

## 它怎么工作

- **宿主半侧** [`lib/index.js`](lib/index.js)：合并三层设置（默认 → patch config → `~/.dsh/offwork.json`，文件每次请求现读），规整成分钟数与日薪，提供只读路由 `GET /api/offwork/config`。
- **浏览器半侧** [`lib/client.js`](lib/client.js)：手写 bundle（无构建步骤），往 `sidebar.footer.action` 槽注册卡片，每 60 秒重取配置、每秒重算倒计时／加班时长与收入。

## License

MIT
