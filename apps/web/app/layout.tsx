import "./globals.css";

export const metadata = {
  title: "领客 · 让每次投递都更有准备",
  description: "领客是贯穿职位发现、资料管理和网申填写的 AI 求职助手。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
