# DSH 花费 / DSH Cost

在输入框下方的统计条里显示当前会话的 DeepSeek API **估算花费**（人民币）。点击数值打开明细：缓存命中/未命中/输出 token 数、高峰与空闲时段小计、所用模型与单价。

## 数据来源

- **Host 半边**（`index.js`）在 `ctx.sessionProjections` 上注册 `deepseekCost` 投影：
  - 从 `assistant/message`（以及带 usage 的 `assistant/attempt`）读取提供方回报的 token 用量；
  - 从 `request/header` 读取 `provider/model` 路由；
  - 按事件时间判断高峰/空闲价（北京时间工作日 9:00–12:00、14:00–18:00 为高峰，其余为空闲）；
  - 同一 turn/step 的流式结算样本会替换而不是累加（与 `tokenUsage` 投影一致）。
- **Client 半边**（`client.js`）只负责格式化与渲染，注册在 `conversation.composer.dock`，与系统自带的「活动 / 用量」统计并排。

价格不写入投影状态，而是在投影的 `wire.view` 发布时计算，因此改价不会让已缓存的投影状态失效。

## 价格表

DeepSeek 官方人民币价目（2026-10-30，元/百万 tokens）：

| 模型 | 时段 | 缓存命中 | 缓存未命中 | 输出 |
|---|---|---|---|---|
| deepseek-flash | 高峰 | 0.04 | 2 | 8 |
| deepseek-flash | 空闲 | 0.02 | 1 | 4 |
| deepseek-v4-pro | 高峰 | 0.30 | 9 | 27 |
| deepseek-v4-pro | 空闲 | 0.15 | 4.5 | 13.5 |

价目表的唯一可编辑来源是 **`prices.json`**：`updatedAt` 是**价目变更日期**（官方真的调价时才变），`checkedAt` 是**最近核对日期**（每日任务每次核对成功都会更新，即使没有调价），`source` 记录官方页面。插件在加载时读取它；文件缺失或格式错误时回退到 `index.js` 的 `DEFAULT_PRICES`。优先级：行配置 `config.prices` > `prices.json` > `DEFAULT_PRICES`。明细弹窗会同时显示「价目变更」和「最近核对」两行。

改价流程：编辑 `prices.json` → 让插件重新加载（重启 DeepSeek Harness，或在插件页禁用再启用）。已经缓存的历史会话不用迁移，重载后按新价目重算。

### 每日自动核对

本工作区已配置一个每天 **10:00（Asia/Shanghai）** 的定时任务：抓取[官方价目页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，与 `prices.json` 逐项比对；**每天都会把 `checkedAt` 更新为当天**（即使价目没变），有变化时才更新 `updatedAt` 与 models（和本文件的价格表）。高峰时段规则变更、模型增删、搜索/抓取开始计费等无法自动套用的情况会明确报告，等你确认后再改代码。

注意：每日任务只改文件，**正在运行的进程要重载插件/重启后才会看到新的日期或价格**——Host 侧不会热替换模块；这个定时任务属于安装者本人，不随插件包分发。

## 分享与部署

插件是标准 DSH bundle（`package.json` 的 `dsh.bundle.patch` + `dsh.client`），没有第三方依赖、不联网，可以整目录分发：

- **Git 仓库（推荐团队使用）**：<https://github.com/noanchor/dsh-cost-meter>
  ```bash
  git clone https://github.com/noanchor/dsh-cost-meter.git ~/dsh-cost-meter
  # 然后让 agent 用 plugin_manager install_bundle 安装 ~/dsh-cost-meter；升级 git pull + 重启 DSH
  ```
- 打好的分发包：`dsh-cost-meter-1.0.1.zip`（位于工作区根目录，内含本目录全部文件）。
- 收件人安装步骤、npm 发布方式、兼容性与排障：见 [`INSTALL.md`](./INSTALL.md)。
- 要求 DSH 版本 ≥ 0.2.1-rc.5；MIT License，见 [`LICENSE`](./LICENSE)。

## 已知边界

- 按官方价目**估算**，不是账单；未剔除中国法定节假日（节假日按高峰计价，会略高估）。
- 只统计当前会话自身的模型用量：子代理（subagent）会话、会话标题生成、网页搜索/抓取费用不包含在内。
- 未知模型按 deepseek-flash 价目估算，并在明细里注明。
- 免费额度、赠送余额、扣费顺序等平台侧规则不在此插件范围内。
