import { routes } from "../../lib/routes";

export const workspaceNavigation = [
  { label: "个人资料", href: routes.profile, icon: "○" },
  { label: "智能填写", href: routes.autofill, icon: "✧" },
  { label: "投递航迹", href: routes.applications, icon: "↗" },
] as const;
