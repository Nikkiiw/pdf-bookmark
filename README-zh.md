# PDF Bookmark

浏览 PDF 书签（大纲/目录），插入层级链接到笔记，并在 PDF 更新后自动修正链接页码。

## 功能

- **浏览 PDF 大纲** — 在侧边栏中查看任意 PDF 的书签目录，支持折叠展开
- **插入层级链接** — 点击书签即可在光标处插入 `[章节 > 小节](相对路径.pdf#page=42)` 格式的链接
- **链接自动修正** — PDF 更新后，运行"Update all PDF bookmark links"命令，自动将所有链接的页码重新映射到正确位置
- **右键菜单复制** — 在 Obsidian 内置 PDF 阅读器的大纲面板中，右键任意书签即可复制完整层级路径的链接

## 使用方法

### 侧边栏浏览器

1. 点击左侧丝带图标，或运行命令面板中的"Open PDF bookmark browser"
2. 点击 **Select PDF**，从库中选择一个 PDF 文件
3. 浏览书签树——点击任意标题可插入链接并打开 PDF 到对应页面
4. 鼠标悬停在行上，点击复制按钮（两个重叠方块的图标）可仅复制不插入

### 右键菜单（PDF 阅读器）

1. 在 Obsidian 中打开 PDF，展开左侧大纲面板
2. 右键任意大纲项
3. 选择 **Copy bookmark link**——链接使用完整层级路径格式

### 更新链接

- PDF 被修改后，如果该 PDF 有已有链接，会收到通知提醒
- 运行命令面板中的 **"Update all PDF bookmark links"**，自动修正所有链接的页码

## 设置

- **Show page numbers in link text** — 在书签路径后显示页码，如 `(p. 42)`
- **Auto-detect PDF updates** — PDF 文件修改后自动提示更新链接

## 链接格式

```
[Jeppesen > Air Traffic Control > COMMUNICATION](../docs/manual.pdf#page=1024)
```

链接使用从笔记到 PDF 的相对路径，即使移动 vault 文件夹也不会断裂。
