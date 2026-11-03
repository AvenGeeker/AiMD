import { BookmarkPlus, Loader2, MessageSquareText, RefreshCw, Sparkles } from 'lucide-react';
import type { NoteSummaryDto } from '@aimarkdown/shared';
import { AuthedImage } from './AuthedImage.js';
import { SourceBadge } from './SourceBadge.js';

export interface FavoriteListProps {
  notes: NoteSummaryDto[];
  selectedId: string | null;
  onOpen(id: string): void;
  loading: boolean;
  platform: string;
  onPlatformChange(value: string): void;
  onCreateFavorite(): void;
  onAskAi(): void;
}

const PLATFORMS = [
  ['', '全部'],
  ['xiaohongshu', '小红书'],
  ['douyin', '抖音'],
  ['wechat', '公众号'],
  ['web', '网页'],
  ['manual', '手动'],
] as const;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function statusLabel(note: NoteSummaryDto): string | null {
  if (note.mediaStatus === 'queued' || note.mediaStatus === 'running') return '识别中';
  if (note.mediaStatus === 'unconfigured') return '未配置媒体模型';
  if (note.mediaStatus === 'error') return '媒体识别失败';
  if (note.mediaStatus === 'partial') return '部分识别完成';
  const category = note.aiCategory;
  if (category?.status === 'queued' || category?.status === 'running') return '分类中';
  if (category?.status === 'suggested') return `建议：${category.suggestion ?? '新类别'}`;
  if (category?.status === 'error') return '分类失败';
  return null;
}

export function FavoriteList({
  notes,
  selectedId,
  onOpen,
  loading,
  platform,
  onPlatformChange,
  onCreateFavorite,
  onAskAi,
}: FavoriteListProps) {
  return (
    <div className="notes-panel flex h-full flex-col" data-testid="favorite-list">
      <div className="notes-header flex shrink-0 items-center justify-between px-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-semibold text-foreground">收藏</span>
          <span className="text-[10.5px] tabular-nums text-muted">{notes.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="icon-button !h-7 !w-7" onClick={onAskAi} title="问 AI" aria-label="问 AI">
            <MessageSquareText size={14} />
          </button>
          <button
            type="button"
            className="icon-button !h-7 !w-7"
            onClick={onCreateFavorite}
            title="收藏链接"
            aria-label="收藏链接"
            data-testid="favorite-add"
          >
            <BookmarkPlus size={15} />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-2">
        {PLATFORMS.map(([value, label]) => (
          <button
            key={value || 'all'}
            type="button"
            onClick={() => onPlatformChange(value)}
            className={`chip shrink-0 !min-h-7 text-[10px] ${platform === value ? 'is-active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4">
        {loading && notes.length === 0 && (
          <div className="flex items-center justify-center py-10 text-xs text-muted">
            <Loader2 size={14} className="mr-2 animate-spin" /> 正在加载收藏
          </div>
        )}
        {!loading && notes.length === 0 && (
          <div className="empty-state mt-6">
            <span className="empty-state-icon"><Sparkles size={19} /></span>
            <div className="text-xs text-muted">还没有收藏</div>
            <button type="button" className="button-secondary mt-1" onClick={onCreateFavorite}>
              <BookmarkPlus size={14} /> 收藏第一个链接
            </button>
          </div>
        )}
        {notes.map((note) => {
          const status = statusLabel(note);
          return (
            <button
              key={note.id}
              type="button"
              onClick={() => onOpen(note.id)}
              data-note-id={note.id}
              className={`favorite-card group text-left ${selectedId === note.id ? 'is-selected' : ''}`}
            >
              <div className="flex gap-3">
                {note.source?.coverAttachmentId ? (
                  <AuthedImage
                    attachmentId={note.source.coverAttachmentId}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="favorite-cover-placeholder h-16 w-16 shrink-0 rounded-lg">
                    <BookmarkPlus size={18} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[12px] font-semibold leading-4 text-foreground">{note.title}</div>
                  <div className="mt-1 line-clamp-2 text-[10.5px] leading-4 text-muted">{note.excerpt}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <SourceBadge source={note.source} />
                    {status ? <span className="favorite-status">{status}</span> : null}
                    <span className="ml-auto text-[9.5px] text-muted/70">{formatDate(note.createdAt)}</span>
                  </div>
                </div>
              </div>
              {note.aiCategory?.status === 'error' || note.mediaStatus === 'error' ? (
                <span className="mt-1 inline-flex items-center gap-1 text-[9.5px] text-danger">
                  <RefreshCw size={9} /> 可在笔记操作中重试
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
