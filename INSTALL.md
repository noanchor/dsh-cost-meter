# 安装 DSH 花费插件（收件人指南）

`dsh-cost-meter` 是一个 DSH（DeepSeek Harness）本地插件：在输入框下方显示**当前会话的 DeepSeek API 估算花费（人民币）**，点开可看 token 明细与当前价目。不联网、不采集数据，全部在本地计算。

## 前置条件

- DeepSeek Harness Desktop（或用 `dsh` 启动、带 Web UI 的 profile）。
- DSH 版本 **≥ 0.2.1-rc.5**（插件在该版本上开发与验证；更低版本缺少 `session projections` / `conversation.composer.dock` 等接口）。
- 安装需要一次授权确认（插件会被装进当前 profile，对所有 workspace 生效）。

## 团队分发推荐：Git 仓库

适合多人、需要持续同步更新。**仓库根目录就是插件目录**（`package.json` 在仓库根，不要再套一层子目录）。

**作者（首次上传）**

```bash
cd dsh-cost-meter
git init -b main
git add -A
git commit -m "dsh-cost-meter 1.0.1"
git tag v1.0.1
git remote add origin git@github.com:noanchor/dsh-cost-meter.git
git push -u origin main --tags
```

**收件人（一条 clone + 一句 agent 指令）**

```bash
git clone git@github.com:noanchor/dsh-cost-meter.git ~/dsh-cost-meter
```

> 请用 plugin_manager 的 install_bundle 动作，把 `/Users/<你>/dsh-cost-meter` 安装为当前 profile 的插件，安装后确认插件行 `include:dsh-cost-meter` 处于启用状态。

（没有配置 GitHub SSH key 的人用 HTTPS 地址即可：`git clone https://github.com/noanchor/dsh-cost-meter.git ~/dsh-cost-meter`。）

装好后输入框下方出现 `≈¥x.xx`。**以后升级**：在克隆目录里 `git pull`（目录安装是链接，不需要重装）→ 重启 DSH 生效；想锁定版本就 `git checkout v1.0.1`。

**可选：不让对方 clone，直接让 agent 从 git 安装**

> 请用 plugin_manager 的 install_bundle 动作安装 `git+https://github.com/noanchor/dsh-cost-meter.git#v1.0.1`。

（走 pnpm 的 git 依赖，能用；但升级时要重装。推荐 clone + 目录安装。）

## 方式 A：目录安装（1–2 人分享最快，无需 npm）

1. 把压缩包 `dsh-cost-meter-1.0.1.zip` 解压到本机任意目录，例如：
   - macOS：`~/Documents/deepseek-harness/default-workspace/dsh-cost-meter`
   - Windows：`%USERPROFILE%\Documents\dsh-cost-meter`
   （放在自己的 workspace 下最方便，以后改价目表直接改这个目录里的 `prices.json`。）
2. 打开 DSH，在任意会话里把下面这段发给 agent（把路径替换成你的实际解压路径）：

   > 请用 plugin_manager 的 install_bundle 动作，把 `/你的路径/dsh-cost-meter` 安装为当前 profile 的插件，安装后确认插件行 `include:dsh-cost-meter` 处于启用状态。

3. agent 会发起授权请求，同意即可。安装结果里应看到 `application: applied`。
4. 验证：回到会话，输入框下方统计条出现 **`≈¥x.xx`** 金币标签（在系统自带的「活动」「用量」右侧），点开有明细。若没有出现，刷新页面或重启 DSH；仍没有就去 **设置 → 插件**（Plugins）确认「DSH 花费 / DSH Cost」已启用。

## 方式 B：通过 npm（公开或公司私有 registry）

适合团队内多人分发或放入插件市场索引。

1. 在插件目录里改 `package.json`：
   - `"name"` 换成你自己的 scope，例如 `"@yourname/dsh-cost-meter"`；
   - `"private": true` 改为 `false`；
   - 按需补 `"author"`、`"repository"`，`license` 已是 MIT。
2. 发布：
   ```bash
   npm publish --access public        # 或公司私有 registry
   ```
3. 其他人安装：
   > 请用 plugin_manager 的 install_bundle 动作安装 `@yourname/dsh-cost-meter@1.0.1`。

（`plugin_manager` 的 `install_bundle` 也接受本地目录路径和 npm 安装 spec。）

## 方式 C：直接同步目录

同团队成员如果能访问同一个文件系统（网盘/共享目录），把整个 `dsh-cost-meter/` 目录同步过去后，按方式 A 的第 2 步安装即可——目录安装是用链接方式挂进 profile 的，不是拷贝，所以目录要保留、不要移动。

## 安装之后

- **生效范围**：安装到当前 profile；切换 profile 后需要在该 profile 重新安装。
- **卸载**：设置 → 插件里禁用/卸载，或让 agent 执行 `plugin_manager remove_bundle`（目标 `@local/dsh-cost-meter`）。
- **价目表**：唯一来源是插件目录里的 `prices.json`（人民币/百万 tokens，含高峰/空闲）。字段语义：
  - `updatedAt` = **价目变更日期**（官方真的调价时才变）；
  - `checkedAt` = **最近核对日期**（每日核对任务每天都会更新，即使没有调价）；
  - 明细弹窗会显示「价目变更」与「最近核对」两行。
  改完需要重载插件（重装或重启 DSH）才生效；插件**不会自动联网更新价格**。
- **每日价目核对**：本作者的机器上有一个每天 10:00 的定时任务负责核对官方价目，该定时任务**不会随插件分享**。想让自己的 agent 也自动核对，见下方「可选：给自己配每日价目核对」。
- **数据来源**：插件在 Host 侧注册 `deepseekCost` 会话投影，只读本机会话日志里的 `assistant/message` token 用量与 `request/header` 模型路由；Client 侧只渲染。不发起任何网络请求。
- **已知边界**：估算而非账单；未剔除中国法定节假日（会略高估）；不含子代理会话、标题生成，以及官方按次/按量计费的直接 Search/Fetch API 调用、文件解析/OCR、TTS/ASR 费用。自 2026-11-18 12:00（北京时间）起，模型经联网工具触发的服务端搜索/抓取不再单独计费，模型侧花费即 token 费用。

## 可选：给自己配每日价目核对

把下面这段发给自己的 agent（把 `<插件目录>` 替换成实际路径），它就会通过本会话的定时任务每天核对官方价目：

> 请创建一个每天 10:00（Asia/Shanghai）的定时任务，名为「核对 DSH 花费插件价目」。每次执行：
> 1. 用 web_fetch 抓 https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ （失败再抓 https://api-docs.deepseek.com/quick_start/pricing/ ），提取 deepseek-flash 与 deepseek-v4-pro 的人民币价目（元/百万 tokens，高峰/空闲 × 缓存命中/未命中/输出）及高峰时段定义。
> 2. 读取 `<插件目录>/prices.json`，逐项对比价目数值。
> 3. 无论价目是否有变化，都把 `checkedAt` 更新为当天日期（Asia/Shanghai，YYYY-MM-DD）并写回 `prices.json`；校验 JSON 可解析。
> 4. 价目与 `updatedAt` 都没变：只回复「价目无变化（最近核对 YYYY-MM-DD）」。
> 5. 价目有变化：更新 models（保持 `{peak:{cacheHit,cacheMiss,output}, offPeak:{...}}` 结构）并把 `updatedAt` 改为当天，报告旧价→新价 diff 与「需重载插件/重启 DSH 后生效」。
> 6. 遇到结构变化（高峰时段、币种、新增计费项、模型下线等）不要改价目，只报告发现等我确认。
> 7. 不要重启应用、不要改 profile 配置、不要动插件安装状态。

## 兼容性与故障排查

| 现象 | 处理 |
|---|---|
| `plugin_manager` 报版本不满足 | 升级 DSH 到 ≥ 0.2.1-rc.5 |
| 安装成功但界面没有标签 | 刷新页面 / 重启 DSH；确认插件已启用；确认当前会话已有 token 用量（新会话未发消息时不显示） |
| 明细里「最近核对」日期不更新 | 该日期来自 `prices.json` 的 `checkedAt`，由每日任务写入；插件只在加载时读取，改完需重载插件/重启 DSH 才显示 |
| 明细里模型显示 `deepseek-flash` 但实际用别的模型 | 未知模型按 deepseek-flash 价目估算，明细会标注；可在 `prices.json` 里补该模型价目 |
| 想改价目后立刻生效 | 重载插件或重启 DSH（Host 侧模块不会热替换） |

MIT License，见 `LICENSE`。技术细节见 `README.md`。
