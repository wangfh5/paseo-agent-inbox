Agent 收件箱把你连接的所有主机上的顶层 agent 汇总到同一个地方，并按是否需要你处理来排列。它会添加一个 **Agent inbox** 页面和一个侧栏入口，侧栏徽标显示需要关注的 agent 数量。点击某个 agent 会打开它在 Paseo 中原本的聊天界面，回复、审批权限等操作都在那里完成。

agent 分布在四个区块中，并随状态变化在区块之间移动。**Needs attention** 包含有待审批权限、出错，或已完成但尚未被你 Settle 的 agent。打开聊天查看并不等于 Settle，所以不会因为点开过就从待办里消失；**Working** 包含正在运行的 agent；**Snoozed** 和 **Settled** 是你暂时放下的 agent，Settled 也包括没有待办的空闲 agent。宽屏上分为两栏：左侧上方是需要关注、下方是 Working，右侧上方是 Snoozed、下方是 Settled；窄屏和手机上则排成一列。搜索可以匹配标题、主机、项目、路径和模型。

默认隐藏子 agent，列表、计数和徽标都不包含它们。判断依据是 agent 自身 Paseo 元数据中记录的父 agent，因此父 agent 离线、已存档或在其他主机上时，子 agent 同样会被隐藏；被 detach 的 agent 会重新显示为顶层 agent。不会根据标题猜测。所属 workspace 已存档的 agent 不会显示，这与 Paseo 自身侧栏一致。打开 **Show subagents** 设置后，子 agent 会缩进显示在父 agent 下方。

**Settle** 必须由你手动操作，表示你已经处理了这个 agent 当前这一轮任务：它会移到 Settled，直到出现新的情况，例如新的权限请求、新错误、又一轮任务完成或新的提问。**Snooze** 会把它隐藏到你选择的时间（1 小时或 3 小时后、今晚、明天、下周，或自定义日期时间与时长），出现新的权限请求、错误或任务完成时会提前唤醒。刷新、重连、改名和阅读聊天都不会让已 Settle 或 Snooze 的 agent 重新出现；Snooze 到期后，即使期间你已经看过聊天，它也会回到 Needs attention。插件首次运行时已经空闲的 agent 一开始就算作已 Settle。两者都可以撤销。

插件通过你现有的主机连接读取 agent 和 workspace 列表，不会修改你的 agent：不改名、不存档、不停止、不发送消息，也不标记已读。Settle 和 Snooze 的状态保存在安装插件的那台主机的设置文档中，该主机的所有客户端共享。建议只装在一台客户端都会连接的主机上；每多装一处，就会多一份互不相通的 Settle 和 Snooze 状态。离线或加载失败的主机会被提示并跳过，其 agent 的 Settle 和 Snooze 状态会保留。

需要 Paseo 0.14 或更高版本。基于 omercnet 的 Agent monitor 改写。
