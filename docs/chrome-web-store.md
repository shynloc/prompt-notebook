# Chrome Web Store release package

## Listing

- Name: `Prompt Notebook 提示词笔记本`
- Category: Productivity
- Language: Chinese (Simplified)
- Homepage: `https://prompts.example.com/extension`
- Privacy policy: `https://prompts.example.com/privacy`
- Support URL: `https://prompts.example.com/extension`

### Short description

选中网页中的提示词，检查自动识别的标题与配图，然后保存到你的私人 Prompt Notebook。

### Detailed description

Prompt Notebook 把网页提示词收藏流程放进 Chrome 侧边栏：

- 选中文字后通过工具栏、右键菜单或 Alt+Shift+P 开始收藏；
- 自动带入来源网页、附近标题和候选配图；
- 保存前编辑标题、提示词、标签和图片；
- 使用安全、可撤销的设备授权连接个人笔记本；
- 只在用户明确操作后临时读取当前标签页。

扩展不会持续读取浏览记录，不读取网页 Cookie，也不向广告服务发送数据。

## Permission justifications

- `activeTab`: temporarily inspect the current page after an explicit user gesture.
- `contextMenus`: provide “保存到提示词笔记本中” for selected text.
- `scripting`: run the page collector only in the active tab after a gesture.
- `sidePanel`: keep the editable capture card visible beside the source page.
- `storage`: retain an unsaved local draft and the user's device tokens.
- `identity`: complete PKCE authorization through `launchWebAuthFlow`.
- Optional host permission: communicate only with the self-hosted HTTPS origin entered and approved by the user.

## Submission checklist

1. Upload the versioned `prompt-notebook-chrome-<version>.zip` release asset.
2. Upload the 128 px icon and at least one 1280x800 or 640x400 screenshot.
3. Paste the listing copy and permission justifications above.
4. Select single purpose: save user-selected prompts and optional artwork to Prompt Notebook.
5. Declare that account authentication is required and provide review credentials if the store reviewer requests them.
6. Confirm the privacy disclosures against the deployed `/privacy` page.
7. Publish first to a trusted-tester group, then promote the same signed release to public after validation.
