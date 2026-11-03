import { ExternalLink, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import type { NoteSummaryDto, TreeDto } from '@aimarkdown/shared';
import {
  useClassifyFavorite,
  useCreateFolder,
  useRetryFavoriteMedia,
  useSetFavoriteCategory,
} from '../lib/queries.js';
import { SourceBadge } from './SourceBadge.js';

export function FavoriteNoteBar({ note, tree }: { note: NoteSummaryDto; tree: TreeDto | undefined }) {
  const classify = useClassifyFavorite();
  const retryMedia = useRetryFavoriteMedia();
  const setCategory = useSetFavoriteCategory();
  const createFolder = useCreateFolder();
  if (!note.source) return null;
  const rootId = tree?.settings.favoritesFolderId;
  const categories = (tree?.folders ?? []).filter((folder) => folder.parentId === rootId);
  const category = note.aiCategory;
  const busy = classify.isPending || retryMedia.isPending || setCategory.isPending || createFolder.isPending;

  const acceptSuggestion = async () => {
    if (!rootId || !category?.suggestion) return;
    const folder = await createFolder.mutateAsync({ name: category.suggestion, parentId: rootId });
    await setCategory.mutateAsync({
      noteId: note.id,
      action: 'set',
      folderId: folder.id,
      name: category.suggestion,
    });
  };

  return (
    <div className="favorite-note-bar" data-testid="favorite-note-bar">
      <SourceBadge source={note.source} />
      {note.source.url ? (
        <a href={note.source.url} target="_blank" rel="noreferrer" className="favorite-source-link">
          <ExternalLink size={10} /> 查看原文
        </a>
      ) : null}
      {category?.status === 'suggested' && category.suggestion ? (
        <span className="favorite-suggestion">
          <Sparkles size={10} /> AI 建议归入「{category.suggestion}」
          <button type="button" className="text-accent hover:underline" onClick={() => void acceptSuggestion()} disabled={busy}>新建并归类</button>
          <button type="button" className="inline-flex items-center gap-0.5 text-muted hover:text-foreground" onClick={() => void setCategory.mutateAsync({ noteId: note.id, action: 'dismiss' })}>
            <X size={9} /> 留在待分类
          </button>
        </span>
      ) : null}
      {category?.status === 'error' ? <span className="text-danger">分类失败</span> : null}
      {note.mediaStatus === 'unconfigured' ? <span className="text-warning">未配置媒体模型</span> : null}
      {note.mediaStatus === 'error' || note.mediaStatus === 'partial' ? <span className="text-warning">媒体识别未完成</span> : null}
      {category?.status === 'queued' || category?.status === 'running' ? (
        <span className="inline-flex items-center gap-1 text-muted"><Loader2 size={10} className="animate-spin" /> 分类中</span>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <select
          value={category?.folderId ?? ''}
          onChange={(event) => {
            const folder = categories.find((item) => item.id === event.target.value);
            if (folder) void setCategory.mutateAsync({ noteId: note.id, action: 'set', folderId: folder.id, name: folder.name });
          }}
          className="select-base !min-h-7 max-w-32 text-[10px]"
          aria-label="收藏分类"
        >
          <option value="">选择分类…</option>
          {categories.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
        <button type="button" className="icon-button !h-7 !w-7" title="重新分类" onClick={() => void classify.mutateAsync(note.id)} disabled={busy}>
          <Sparkles size={13} />
        </button>
        {note.mediaStatus !== 'idle' ? (
          <button type="button" className="icon-button !h-7 !w-7" title="重试媒体识别" onClick={() => void retryMedia.mutateAsync(note.id)} disabled={busy}>
            <RefreshCw size={13} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
