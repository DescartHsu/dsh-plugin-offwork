# dsh-plugin-offwork

下班倒计时 + 今日已赚，两张挂在**侧边栏底部**的统计卡片，for [DeepSeek Harness](https://github.com/deepseek-ai/dsh)。

## 它做什么

| 卡片 | 显示 | 细节 |
|---|---|---|
| 下班还有 | `01:10:25` 式倒计时，每秒刷新 | 右侧 12 根柱子＝今天的工作进度；到点变「已下班 00:00:00」；非工作日显示「今天不上班」 |
| 今日已赚 | `539.62 ¥`，2 位小数 | 日薪 × 已上班时长 ÷ 工作日总时长，到下班点拿满；右侧标日薪全额 |

样式对齐「今日消耗 Token」那张卡：白底圆角、灰色小标签、大号等宽数字、左侧圆角图标、右侧迷你图。挂在侧边栏 footer，位置在计费卡（若装了）下面、设置按钮上面；侧边栏收起时随 footer 一起隐藏。

## 安装

发布后从 DSH 插件市场装；本机立即用：

```bash
bash offwork-setup/apply.sh      # 装（幂等，首次会快照 package.json）
bash offwork-setup/rollback.sh   # 卸，从快照整份恢复
```

装完**完全退出并重启 DSH Desktop**，卡片出现在侧边栏底部。

## 配置

全部设置就是仓库里的 [`cordis.patch.yml`](cordis.patch.yml) 一段 config：

```yaml
workStart: "09:00"        # 上班
workEnd: "17:40"          # 下班
dailySalary: 600          # 日薪（元），到下班点拿满
workdays: [1, 2, 3, 4, 5] # 1=周一 … 7=周日
```

改完重新 `bash offwork-setup/apply.sh` 同步进 node_modules，再重启 DSH Desktop。**不要直接改 node_modules 里的副本**——会被下一次 apply 覆盖，思路请改仓库文件（README / cordis.patch.yml）。

## 它怎么工作

- **宿主半侧** [`lib/index.js`](lib/index.js)：读 patch config，规整成分钟数，提供只读路由 `GET /api/offwork/config`。
- **浏览器半侧** [`lib/client.js`](lib/client.js)：手写 bundle（无构建步骤），往 `sidebar.footer.action` 槽注册卡片，取回配置后每秒重算倒计时与收入。

## License

MIT
