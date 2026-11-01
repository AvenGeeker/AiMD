import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { AppleNotesController } from '../hooks/useAppleNotes.js';

export function AppleNotesPreviewDialog({
  controller,
  onClose,
}: {
  controller: AppleNotesController;
  onClose(): void;
}) {
  const preview = controller.preview;
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => setConfirmed(false), [preview?.token]);
  if (!preview) return null;
  const plan = preview.plan;
  const rows: Array<[string, number]> = [
    ['从备忘录导入笔记', plan.createAppNotes],
    ['把 aiMarkdown 笔记写入备忘录', plan.createAppleNotes],
    ['更新 app 笔记', plan.updateAppNotes],
    ['更新备忘录', plan.updateAppleNotes],
    ['删除 app 笔记（进回收站）', plan.trashAppNotes],
    ['删除备忘录（进回收站目录）', plan.trashAppleNotes],
    ['新建 app 目录', plan.createAppFolders],
    ['新建备忘录目录', plan.createAppleFolders],
    ['移动 app 目录', plan.moveAppFolders],
    ['移动备忘录目录', plan.moveAppleFolders],
    ['删除 app 目录', plan.deleteAppFolders],
    ['删除备忘录目录', plan.deleteAppleFolders],
    ['冲突', plan.conflicts],
    ['只读/跳过', plan.readOnly],
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" data-testid="apple-notes-preview-dialog">
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">macOS 备忘录同步预览</h2>
          <button type="button" className="rounded p-1 text-muted hover:bg-hover" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 overflow-auto px-4 py-4 text-xs">
          <div className="grid grid-cols-2 gap-2 rounded border border-border bg-background/50 p-2">
            <span>aiMarkdown：{preview.counts.appNotes} 篇 / {preview.counts.appFolders} 个目录</span>
            <span>Apple 备忘录：{preview.counts.appleNotes} 篇 / {preview.counts.appleFolders} 个目录</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {rows.filter(([, value]) => value > 0).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2">
                <span className="text-muted">{label}</span>
                <span className="tabular-nums">{value}</span>
              </div>
            ))}
          </div>
          {preview.warnings.length > 0 && (
            <div className="space-y-1 rounded border border-warning/40 bg-warning/10 p-2 text-warning">
              <div className="flex items-center gap-1 font-medium"><AlertTriangle size={13} /> 需要只读/跳过的笔记</div>
              {preview.warnings.slice(0, 8).map((warning) => <div key={warning}>{warning}</div>)}
              {preview.warnings.length > 8 && <div>还有 {preview.warnings.length - 8} 条…</div>}
            </div>
          )}
          {preview.samples.length > 0 && (
            <div className="space-y-1">
              <div className="text-muted">示例</div>
              {preview.samples.slice(0, 8).map((sample, index) => (
                <div key={`${sample.title}-${index}`} className="truncate rounded bg-hover px-2 py-1">
                  {sample.direction === 'app-to-apple' ? '→ 备忘录' :
                    sample.direction === 'apple-to-app' ? '← 备忘录' :
                      sample.direction === 'conflict' ? '⚠ 冲突' : '只读'}：{sample.title}
                </div>
              ))}
            </div>
          )}
          <label className="flex items-start gap-2 rounded border border-border p-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4"
              data-testid="apple-notes-confirm"
            />
            <span>
              我已了解：确认后会双向创建、修改和删除笔记与目录；删除会进入 app 回收站或 Apple 的 aiMarkdown 回收站目录，冲突会生成副本。
            </span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" className="rounded border border-border px-3 py-1.5 text-xs hover:bg-hover" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="rounded bg-accent px-3 py-1.5 text-xs text-accent-foreground disabled:opacity-50"
            disabled={!confirmed || controller.busy}
            onClick={() => void controller.apply(preview.token)}
            data-testid="apple-notes-apply"
          >
            {controller.busy ? '正在同步…' : '开始同步'}
          </button>
        </div>
      </div>
    </div>
  );
}
