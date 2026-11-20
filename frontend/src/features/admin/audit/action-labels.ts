const ACTION_LABELS: Record<string, string> = {
  'user.login': '用户登录',
  'user.logout': '用户登出',
  'user.create': '创建用户',
  'user.update': '更新用户',
  'user.approve': '通过审批',
  'user.reject': '拒绝注册',
  'user.delete': '删除用户',
  'user.session_revoke': '吊销会话',
  'user.role_change': '修改用户角色',
  'role.create': '创建角色',
  'role.update': '更新角色',
  'role.delete': '删除角色',
  'role.permissions_update': '修改角色权限',
  'tool.meta.update': '更新工具元数据',
  'tool.meta.bulk_update': '批量更新工具元数据',
  'tool.qrcode.generate': '生成二维码',
  'tool.asset.scan': '资产核对扫描',
  'tool.asset.compare': '创建资产核对任务',
  'tool.asset.finalize': '资产核对归档',
  'tool.attendance.process': '出勤整理导出',
  'tool.attendance.analyze': '出勤整理分析',
  'tool.attendance.download': '下载出勤结果',
  'tool.attendance.delete_result': '删除出勤结果',
  'tool.atlas_merge.analyze': 'AtlasLog 合并',
  'tool.atlas_merge.download': '下载 AtlasLog 结果',
  'tool.atlas_merge.delete_result': '删除 AtlasLog 结果',
  'tool.cpk_charts.parse': '解析 OPP 数据集',
  'tool.box_plot.analyze': '箱线图分析',
  'tool.tt_time.process': '测试时间处理',
  'tool.tt_time.analyze': '测试时间分析',
  'tool.retest_rate.analyze': '重测率分析',
  'llm.config.update': '更新模型配置',
  'llm.config.reset': '重置模型配置',
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

export function actionColor(action: string): string {
  if (action.startsWith('user.')) return 'blue'
  if (action.startsWith('role.')) return 'purple'
  if (action.startsWith('tool.')) return 'green'
  if (action.startsWith('llm.')) return 'orange'
  return 'default'
}
