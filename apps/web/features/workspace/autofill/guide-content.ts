export type GuideScreenshot = { src: string; width: number; height: number; alt: string; caption: string };
export type GuideStep = { title: string; text: string; screenshot: GuideScreenshot; action?: 'extensionsAddress' };
export const extensionDownloadFilename = 'AI-领客扩展.zip';

export const profilePreview: GuideScreenshot = {
  src: 'profile-with-pet.webp', width: 950, height: 232,
  alt: '领客真实个人资料页面与展开后的飞鼠开始填写按钮',
  caption: '领客界面实拍 · 资料为演示数据',
};

export const browserSteps: GuideStep[] = [
  { title: '下载 Chrome 安装包', text: '点击下方链接进入 Chrome 官网，再点击「下载 Chrome」。Windows 保存 ChromeSetup.exe；macOS 保存 googlechrome.dmg。', screenshot: { src: 'chrome-install.webp', width: 960, height: 450, alt: 'Chrome 官网中文页面上的下载 Chrome 按钮', caption: 'Chrome 中文官网实拍 · 图中为 macOS 下载入口' } },
  { title: '打开安装包', text: '下载完成后找到安装文件。Windows 双击 ChromeSetup.exe；macOS 双击 googlechrome.dmg，等待安装窗口打开。', screenshot: { src: 'chrome-package.webp', width: 1553, height: 330, alt: '访达中从 Google 官方下载的 googlechrome.dmg 安装包', caption: '安装包实拍 · macOS 示例，Windows 文件名为 ChromeSetup.exe' } },
  { title: '完成浏览器安装', text: 'Windows 如出现系统权限提示，点击「是」，等待安装完成；macOS 把 Google Chrome 图标拖入右侧 Applications（应用程序）文件夹。', screenshot: { src: 'chrome-install-window.webp', width: 1266, height: 640, alt: 'Google Chrome 官方 macOS 安装窗口，左侧是 Chrome 图标，右侧是应用程序文件夹', caption: '官方安装窗口实拍 · macOS 将左侧 Chrome 拖入右侧应用程序' } },
  { title: '启动 Chrome', text: 'Windows 从开始菜单打开 Google Chrome；macOS 从「应用程序」打开。看到浏览器窗口后，用 Chrome 回到领客，继续「安装扩展」。', screenshot: { src: 'chrome-ready.webp', width: 2690, height: 1060, alt: 'Chrome 浏览器打开后的真实新标签页，显示地址栏和 Google 搜索框', caption: 'Chrome 新标签页实拍 · 界面可能随版本不同' } },
];

export const installSteps: GuideStep[] = [
  { title: '下载领客扩展', text: `点击页面顶部「下载 Chrome 扩展」，保存 ${extensionDownloadFilename}。`, screenshot: { src: 'download.webp', width: 503, height: 324, alt: '领客智能填写页面顶部的下载 Chrome 扩展按钮', caption: '顶部下载入口实拍 · 使用页面顶部按钮下载安装包' } },
  { title: '解压安装包', text: 'Windows 右键 ZIP，选择「全部解压缩」；macOS 双击 ZIP。找到解压后的 lingke-extension 文件夹，安装后请保留。', screenshot: { src: 'unpacked.webp', width: 1553, height: 210, alt: '访达中真实的 lingke-extension 扩展文件夹', caption: '解压后的文件夹实拍 · 安装时选择此文件夹' } },
  { title: '打开扩展管理', text: '复制下方地址，粘贴到 Chrome 新标签页的地址栏并打开。截图红圈标出了地址栏。', action: 'extensionsAddress', screenshot: { src: 'extensions.webp', width: 2690, height: 1552, alt: '完整 Chrome 浏览器实拍，红圈标出地址栏中的 chrome://extensions', caption: '完整浏览器实拍 · 红圈为地址栏，点击图片可放大' } },
  { title: '开启开发者模式', text: '打开右上角红圈内的「开发者模式 / Developer mode」开关，蓝色表示已开启。', screenshot: { src: 'developer-mode.webp', width: 2690, height: 1552, alt: '完整 Chrome 扩展管理页面，红圈标出右上角的 Developer mode 开关', caption: '完整浏览器实拍 · 右上角红圈为开发者模式' } },
  { title: '加载已解压的扩展', text: '点击左上角红圈内的「加载已解压的扩展程序 / Load unpacked」，打开文件夹选择窗口。', screenshot: { src: 'load-unpacked.webp', width: 2690, height: 1552, alt: '完整 Chrome 扩展管理页面，红圈标出左上角的 Load unpacked 按钮', caption: '完整浏览器实拍 · 左上角红圈为加载按钮' } },
  { title: '选择扩展文件夹', text: '选择刚才解压得到的 lingke-extension 文件夹并确认。不要单独选择 manifest.json；出现领客扩展卡片即安装成功。', screenshot: { src: 'load-folder.webp', width: 1313, height: 896, alt: 'Chrome 真实文件夹选择器，打开了包含 manifest.json 的 lingke-extension 文件夹', caption: '文件夹选择器实拍 · macOS 点击 Select，Windows 点击「选择文件夹」' } },
];

export const useSteps: GuideStep[] = [
  { title: '准备好个人资料', text: '在领客完善个人资料并保持网页登录，扩展会使用当前账号已保存的资料。', screenshot: { src: 'profile.webp', width: 900, height: 260, alt: '领客个人资料页中的基本信息和编辑入口，姓名为陈同学、邮箱为演示地址', caption: '领客个人资料页实拍 · 图中资料为演示数据' } },
  { title: '打开招聘表单', text: '进入目标岗位的简历填写页。刚装好扩展？先刷新招聘页面。', screenshot: { src: 'recruitment.webp', width: 1064, height: 345, alt: '字节跳动真实招聘表单中的申请信息、内推码和意向城市控件', caption: '字节招聘页面实拍 · 仅展示不含个人信息的区域' } },
  { title: '让飞鼠帮你填写', text: '鼠标移到飞鼠上，点击「开始填写」。填写时，飞鼠下方会显示当前进度。', screenshot: { src: 'pet-start.webp', width: 155, height: 130, alt: '领客扩展真实飞鼠形象及下方灰色的开始填写按钮', caption: '已安装领客扩展实拍 · 展开飞鼠即可看到按钮' } },
  { title: '核对后，自行提交', text: '填写结束后检查结果，补充待填内容，再自行提交申请。领客不会替你点击提交。', screenshot: { src: 'review-submit.webp', width: 400, height: 125, alt: '真实字节招聘页面上的隐私政策勾选框和提交简历按钮', caption: '招聘页面提交区域实拍 · 提交操作始终由你完成' } },
];
