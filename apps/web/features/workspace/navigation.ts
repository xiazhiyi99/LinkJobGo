import { routes } from "../../lib/routes";

export const workspaceNavigation = [
  {
    id: "personal-center",
    label: "个人中心",
    href: routes.profileHome,
    icon: "person",
    children: [
      { id: "profile-home", label: "个人主页", href: routes.profileHome },
      { id: "profile", label: "个人资料", href: routes.profile },
      { id: "applications", label: "投递航迹", href: routes.applications },
    ],
  },
  { id: "autofill", label: "智能填写", href: routes.autofill, icon: "autofill" },
] as const;
