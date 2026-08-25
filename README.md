# dsh-session-atlas · 会话地图

DeepSeek Harness（DSH）的非线性对话地图：把会话画成一张可缩放、可拖拽的 DAG 卡片图——每个回合是一张完整卡片，支持从任意回合分叉、卡片内实时流式生长、停靠式回合检查器，以及与官方一致的上游渲染质量。

从 [dsh-synapse](../dsh-synapse) 血统抽取为独立插件（v0.1.0 起独立版本线）。

## 功能

- **回合卡片 DAG**：`Turn N-M` 编号、贝塞尔连线、祖先高亮、折叠芯片
- **画布交互**：相机惯性平移/缩放、卡片拖拽与自适应尺寸、快捷键、视图适配
- **分支操作**：从任意回合开分支、草稿卡、乐观更新、归档
- **实时生长**：1s 轮询 + 订阅式流式文本平滑呈现（FPS 守卫）
- **Context Graph 层**（可选）：物证/笔记节点、引用边、过期指纹标记
- **双通道挂载**：官方 `conversation.view` 插槽 + [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 标签页（未装 better-sidebar 时走官方插槽，不阻塞启动）

## 安装

```bash
dsh plugin --profile web add github:<你的用户名>/dsh-session-atlas
```

（或本地路径 `dsh plugin --profile web add /path/to/dsh-session-atlas`）

## 说明

- 内部 CSS 类前缀 `.syn-` 与 localStorage 键 `syn-*` 继承自 synapse 血统，未做改名——如果你的机器上同时装过 dsh-synapse，请先卸载它再装本插件（两者共用画布状态键会互相干扰）。
- 数据文件默认 `~/.dsh/session-atlas/workspaces.json`，可在 profile 的 cordis.patch.yml 里用 `dataFile` 覆盖。
- 运行时仅依赖 DSH 宿主提供的服务；Node ≥ 22.19。

## License

MIT
