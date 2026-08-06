export type PermanentDeleteConfirmation = "confirmed" | "cancelled" | "mismatch";

export function confirmPermanentCharacterDeletion(profileName: string): PermanentDeleteConfirmation {
  const acknowledged = window.confirm(
    `永久删除 AI Model“${profileName}”？\n\n此操作不可撤销，只会删除 Prompt Notebook 内的角色数据和关联记录。外部图床中的原始图片不会自动删除。`,
  );
  if (!acknowledged) return "cancelled";

  const typedName = window.prompt(
    `二次确认：请输入角色名称“${profileName}”后继续。\n外部图床原文件仍需你自行管理。`,
    "",
  );
  if (typedName === null) return "cancelled";
  return typedName.trim() === profileName ? "confirmed" : "mismatch";
}
