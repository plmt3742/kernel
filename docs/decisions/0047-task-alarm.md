# ADR-0047 · 任务闹铃与本地铃声库（Phase 1）

- 状态：已采纳（Phase 1 实现）
- 日期：2026-10-22
- 相关：ADR-0009（文件与软删除）、ADR-0012（详情弹窗）、ADR-0046（通知通道，独立）

---

## 1. 背景

所有者 2026-10-22 要求：「新增一个闹铃通知功能，在需要完成任务的那一天，设置一个时间点去响铃提醒，铃声可由用户自由导入」。

Phase 1 明确边界：

- **KERNEL 页面打开时响铃**；页面关闭后的系统级响铃不在本切片。
- 闹铃挂在**任务详情**：每个任务一个闹铃时间点。
- 铃声使用**全局铃声库**：用户导入后，在任务里选择；未选择时用内置提示音。

## 2. 决策

### 2.1 任务字段

任务新增两个可选字段（不改变 `dueAt` 的语义）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `alarmAt` | ISO 8601 带偏移 | 闹铃时间点；空 = 不提醒 |
| `alarmSoundId` | string | 全局铃声库 id；空 = 内置提示音 |

`alarmAt` 与 `dueAt` 解耦：用户可在任务截止日当天选任意时间，也可不设截止只设闹铃；修改截止不会静默改闹铃。

### 2.2 全局铃声库

- 元数据：`data/meta/alarm-sounds.json`（`{ sounds: [{ id, name, mime, size, fileName, createdAt }] }`）。
- 音频文件：`data/files/alarm-<id>.<ext>`（`data/` 已 gitignore；**不写本机绝对路径**）。
- 支持 mp3 / wav / ogg / webm / m4a / aac，单文件 ≤10MB；扩展名决定 MIME，文件名由服务端生成，不使用用户路径。
- 端点：
  - `GET /api/alarm/sounds`：列表（不含内部文件名）。
  - `POST /api/alarm/sounds?name=&type=`：RAW body 上传。
  - `GET /api/alarm/sounds/:id/file`：流式播放（`no-store` + `nosniff`）。
  - `POST /api/alarm/sounds/:id/remove`：删除；若仍有未完成任务引用 → 409。
- 删除正在使用的铃声会被拒绝，避免任务静默失去声音；先换铃声或清空任务闹铃。

### 2.3 客户端响铃

- `TaskAlarmWatcher` 挂在应用壳（`AppLayout`），跨页面存活。
- 每 15s 检查本地快照；`alarmAt <= now` 且任务未完成 / 未丢弃、未触发、未在稍后提醒窗口 → 响铃。
- 铃声：任务 `alarmSoundId` → `/api/alarm/sounds/<id>/file`；缺省用 Web Audio 提示音。
- 同时弹应用内「闹铃」弹窗（任务标题 / 时间 / 停止 / 10 分钟后提醒 / 查看任务）；有权限时附浏览器通知。
- 浏览器自动播放可能被拦截：弹窗保留「响铃」按钮，用户点击后恢复播放；设置 → 闹铃可请求通知权限。
- 去重 / 稍后提醒只存 localStorage（`kernel.ui.alarms.fired.v1` / `kernel.ui.alarms.snooze.v1`），**不写 `data/`**。
- 页面关闭后不响铃；这是 Phase 1 的明确边界。

## 3. 非目标

- 不做系统托盘 / Windows 计划任务 / 页面关闭后的后台响铃；不做重复闹铃、贪睡次数、音量、渐强。
- 不做移动原生推送；不把音频上传云端；不接个人微信非官方协议。
- 不改变任务完成 / 截止 / 删除的生命周期语义。

## 4. 安全与隐私

- 音频只存本机；上传走既有数据服务（单写者 + 原子写 + 审计 `alarm.sound.create/remove`）。
- 文件名服务端生成，`GET` 只读索引中的受管文件名；拒绝路径穿越。
- 删除引用护栏（409），避免未完成任务静默无声。
- 闹铃去重 / 稍后提醒仅界面记忆；不写业务数据。
- 浏览器通知权限由用户显式请求；拒绝不影响应用内弹窗。

## 5. 影响面

- `server/alarms.mjs`、`server/index.mjs`（任务字段 + 铃声路由）、`server/schemas.mjs`。
- `src/types.ts`、`src/lib/mutations.ts`、`src/components/TaskDetailModal.tsx`、`src/components/TaskDetail.tsx`、`src/components/TaskAlarmWatcher.tsx`、`src/components/shell/AppLayout.tsx`、`src/views/Settings.tsx`。
- 文档：`docs/02`、`docs/04`、`docs/05`、`docs/README`、`README`、`public/guide.html`；ADR-0047。
- 依赖：无新增（浏览器原生 Audio / Notification）。

## 6. 验证

- 上传 wav → 列表 / 播放 200；任务设置 `alarmAt` + `alarmSoundId` → 快照字段正确。
- 删除被未完成任务引用的铃声 → 409；清空任务引用后可删除。
- 前端：闹铃到点弹窗；停止后刷新不重复；稍后提醒 10 分钟内不重复；浏览器拦截自动播放时「响铃」按钮可恢复。
- `npm run build` + `check:syntax` + `check:docs` + `check:privacy` 全 0；证据 `.qa/alarm-v1/`。
