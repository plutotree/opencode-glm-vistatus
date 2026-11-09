/**
 * Bilingual translations (Chinese / English).
 * Source: opencode-visual-cache/src/index.tsx:86-148
 */

export interface Translations {
  title: string;
  quotaSuffix: string;
  token5h: string;
  token5hCredit: string;
  weekly: string;
  mcp: string;
  resetsIn: string;
  tokenUsed: string;
  plan: string;
  platform: string;
  refreshing: string;
  noData: string;
  noCred: string;
  noCredHint: string;
  lastUpdate: string;
  nextRefresh: string;
  error: string;
  errorPrefix: string;
  collapse: string;
  collapsed: string;
}

const ZH_T: Translations = {
  title: "GLM 额度",
  quotaSuffix: "额度",
  token5h: "5h 限额",
  token5hCredit: "5h 配额",
  weekly: "周配额",
  mcp: "MCP",
  resetsIn: "重置",
  tokenUsed: "已用",
  plan: "套餐",
  platform: "平台",
  refreshing: "刷新中...",
  noData: "等待额度数据...",
  noCred: "未找到凭证",
  noCredHint: "请运行 /connect 认证",
  lastUpdate: "更新",
  nextRefresh: "下次",
  error: "获取失败",
  errorPrefix: "错误",
  collapse: "折叠",
  collapsed: "已用",
};

const EN_T: Translations = {
  title: "GLM Quota",
  quotaSuffix: "Quota",
  token5h: "5h Token",
  token5hCredit: "5h Quota",
  weekly: "Weekly",
  mcp: "MCP",
  resetsIn: "Reset",
  tokenUsed: "Used",
  plan: "Plan",
  platform: "Platform",
  refreshing: "Refreshing...",
  noData: "Waiting for quota data...",
  noCred: "No credentials found",
  noCredHint: "Run /connect to authenticate",
  lastUpdate: "Updated",
  nextRefresh: "Next",
  error: "Fetch failed",
  errorPrefix: "Error",
  collapse: "Collapse",
  collapsed: "used",
};

export function getTranslations(langZH: boolean): Translations {
  return langZH ? ZH_T : EN_T;
}

// ---------------------------------------------------------------------------
// MCP installer translations
// ---------------------------------------------------------------------------

export type McpScope = "local" | "global";

export interface McpServerMeta {
  label: string;
  desc: string;
}

export interface McpI18n {
  scopeTitle: string;
  local: string;
  localDesc: string;
  global: string;
  globalDesc: string;
  pickTitle: (scopeLabel: string) => string;
  pickHint: string;
  servers: Record<string, McpServerMeta>;
  selectAll: string;
  deselectAll: string;
  confirm: (install: number, uninstall: number, scopeLabel: string) => string;
  noChange: string;
  okTitle: string;
  okMsg: (
    installed: number,
    removed: number,
    scopeLabel: string,
    file: string,
  ) => string;
  failTitle: string;
  noCred: string;
  scopeLabel: (scope: McpScope) => string;
}

const ZH_MCP: McpI18n = {
  scopeTitle: "GLM MCP 管理范围",
  local: "Local  ·  当前项目",
  localDesc: "项目根目录 opencode.json / opencode.jsonc",
  global: "Global  ·  全局用户",
  globalDesc: "~/.config/opencode/opencode.json / opencode.jsonc",
  pickTitle: (scopeLabel) => `GLM MCP 服务器 · ${scopeLabel}`,
  pickHint: "勾选 = 安装，取消勾选 = 卸载；仅应用与进入时不同的条目",
  servers: {
    "github-read": {
      label: "开源仓库 MCP",
      desc: "GitHub 仓库知识、代码结构与文件内容",
    },
    "glm-web-reader": {
      label: "网页读取 MCP",
      desc: "网页内容提取与结构化数据获取",
    },
    "glm-web-search": { label: "联网搜索 MCP", desc: "网络搜索与实时信息获取" },
    "glm-vision": {
      label: "视觉理解 MCP",
      desc: "图像分析、视频理解 (GLM-4.6V)",
    },
  },
  selectAll: "全选",
  deselectAll: "全不选",
  confirm: (install, uninstall, scopeLabel) =>
    `▸ 应用变更：安装 ${install} · 卸载 ${uninstall}  →  ${scopeLabel}`,
  noChange: "配置无变化",
  okTitle: "GLM MCP 配置已更新",
  okMsg: (installed, removed, scopeLabel, file) =>
    `已安装 ${installed} · 已卸载 ${removed} → ${scopeLabel}  (${file})`,
  failTitle: "GLM MCP 配置更新失败",
  noCred: "未找到 GLM 凭证，请先运行 /connect 认证",
  scopeLabel: (scope) => (scope === "global" ? "全局" : "项目"),
};

const EN_MCP: McpI18n = {
  scopeTitle: "GLM MCP Manage Scope",
  local: "Local  ·  current project",
  localDesc: "Project root opencode.json / opencode.jsonc",
  global: "Global  ·  user-wide",
  globalDesc: "~/.config/opencode/opencode.json / opencode.jsonc",
  pickTitle: (scopeLabel) => `GLM MCP Servers · ${scopeLabel}`,
  pickHint: "Checked = install, unchecked = uninstall; only diffs apply",
  servers: {
    "github-read": {
      label: "Repo Knowledge",
      desc: "GitHub repo docs, code structure & file content",
    },
    "glm-web-reader": {
      label: "Web Reader",
      desc: "Web page content extraction & structured data",
    },
    "glm-web-search": {
      label: "Web Search",
      desc: "Web search & real-time information",
    },
    "glm-vision": {
      label: "Vision",
      desc: "Image analysis & video understanding (GLM-4.6V)",
    },
  },
  selectAll: "Select All",
  deselectAll: "Deselect All",
  confirm: (install, uninstall, scopeLabel) =>
    `▸ Apply: install ${install} · uninstall ${uninstall}  →  ${scopeLabel}`,
  noChange: "No changes",
  okTitle: "GLM MCP Config Updated",
  okMsg: (installed, removed, scopeLabel, file) =>
    `${installed} installed · ${removed} removed → ${scopeLabel}  (${file})`,
  failTitle: "GLM MCP Config Update Failed",
  noCred: "No GLM credentials found. Run /connect to authenticate",
  scopeLabel: (scope) => scope,
};

export function getMcpTranslations(langZH: boolean): McpI18n {
  return langZH ? ZH_MCP : EN_MCP;
}

// ---------------------------------------------------------------------------
// Settings menu translations (/glm-config)
// ---------------------------------------------------------------------------

export interface SettingsI18n {
  menuTitle: string;
  menuLang: string;
  menuBorder: string;
  menuInterval: (cur: string) => string;
  menuVisibility: string;
  visibilityAlways: string;
  visibilityMatched: string;
  menuDone: string;
  intervalTitle: string;
  intervalPresets: { label: string; minutes: number }[];
  intervalCustom: string;
  intervalCustomTitle: string;
  intervalCustomPlaceholder: string;
  intervalInvalid: (min: number, max: number) => string;
  intervalSaved: (label: string) => string;
  on: string;
  off: string;
  minutes: (n: number) => string;
  cancel: string;
}

export function formatIntervalLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

const ZH_SETTINGS: SettingsI18n = {
  menuTitle: "GLM 额度设置",
  menuLang: "显示语言",
  menuBorder: "面板边框",
  menuInterval: (cur) => `刷新间隔  ·  当前 ${cur}`,
  menuVisibility: "显示条件",
  visibilityAlways: "始终显示",
  visibilityMatched: "按当前供应商显示",
  menuDone: "完成",
  intervalTitle: "选择刷新间隔",
  intervalPresets: [
    { label: "1 分钟", minutes: 1 },
    { label: "2 分钟", minutes: 2 },
    { label: "5 分钟（默认）", minutes: 5 },
    { label: "10 分钟", minutes: 10 },
    { label: "30 分钟", minutes: 30 },
    { label: "1 小时", minutes: 60 },
  ],
  intervalCustom: "自定义...",
  intervalCustomTitle: "自定义刷新间隔（分钟，1-1440）",
  intervalCustomPlaceholder: "例如：15",
  intervalInvalid: (min, max) =>
    `无效输入：请输入 ${min} 到 ${max} 之间的整数分钟数`,
  intervalSaved: (label) => `刷新间隔已设为 ${label}`,
  on: "开",
  off: "关",
  minutes: (n) => `${n} 分钟`,
  cancel: "取消",
};

const EN_SETTINGS: SettingsI18n = {
  menuTitle: "GLM Quota Settings",
  menuLang: "Display Language",
  menuBorder: "Panel Border",
  menuInterval: (cur) => `Refresh Interval  ·  current ${cur}`,
  menuVisibility: "Panel Visibility",
  visibilityAlways: "Always show",
  visibilityMatched: "Only when provider matches",
  menuDone: "Done",
  intervalTitle: "Select Refresh Interval",
  intervalPresets: [
    { label: "1 minute", minutes: 1 },
    { label: "2 minutes", minutes: 2 },
    { label: "5 minutes (default)", minutes: 5 },
    { label: "10 minutes", minutes: 10 },
    { label: "30 minutes", minutes: 30 },
    { label: "1 hour", minutes: 60 },
  ],
  intervalCustom: "Custom...",
  intervalCustomTitle: "Custom Refresh Interval (minutes, 1-1440)",
  intervalCustomPlaceholder: "e.g. 15",
  intervalInvalid: (min, max) =>
    `Invalid input: enter an integer between ${min} and ${max} minutes`,
  intervalSaved: (label) => `Refresh interval set to ${label}`,
  on: "ON",
  off: "OFF",
  minutes: (n) => `${n} minute${n === 1 ? "" : "s"}`,
  cancel: "Cancel",
};

export function getSettingsTranslations(langZH: boolean): SettingsI18n {
  return langZH ? ZH_SETTINGS : EN_SETTINGS;
}
