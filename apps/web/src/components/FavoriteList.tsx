import {
  Bookmark,
  BookmarkPlus,
  Check,
  Globe2,
  Loader2,
  MessageCircle,
  MessageSquareText,
  Music2,
  Pin,
  PinOff,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { NoteSummaryDto } from '@aimarkdown/shared';
import type { NoteBatchController } from '../hooks/useNoteBatch.js';
import { formatNoteDate } from '../lib/relativeTime.js';
import { hapticTap } from '../lib/haptics.js';
import { AuthedImage } from './AuthedImage.js';
import { SourceBadge } from './SourceBadge.js';
import { SwipeRow, type SwipeAction } from './SwipeRow.js';

export interface FavoriteListProps {
  notes: NoteSummaryDto[];
  selectedId: string | null;
  onOpen(id: string): void;
  loading: boolean;
  platform: string;
  onPlatformChange(value: string): void;
  onCreateFavorite(): void;
  onAskAi(): void;
  /** The phone shell renders its own large-title header, so the card list hides this one. */
  hideHeader?: boolean;
  /** Present on the touch surfaces: enables swipe actions and long-press multi-select. */
  batch?: NoteBatchController;
  openRowId?: string | null;
  onOpenRowIdChange?(id: string | null): void;
  onTogglePin?(note: NoteSummaryDto): void;
}

const PLATFORMS = [
  ['', '全部'],
  ['xiaohongshu', '小红书'],
  ['douyin', '抖音'],
  ['wechat', '公众号'],
  ['web', '网页'],
  ['manual', '手动'],
] as const;

const COVER_ICON: Record<string, typeof Bookmark> = {
  douyin: Music2,
  wechat: MessageCircle,
  web: Globe2,
  manual: Bookmark,
  xiaohongshu: Bookmark,
};

const COVER_TINT: Record<string, string> = {
  xiaohongshu: '#c43c34',
  wechat: '#218a55',
  douyin: '#7d8bf2',
};

interface StatusChip {
  label: string;
  tone: 'busy' | 'warn' | 'accent';
}

function statusChip(note: NoteSummaryDto): StatusChip | null {
  if (note.mediaStatus === 'queued' || note.mediaStatus === 'running') return { label: '识别中', tone: 'busy' };
  if (note.mediaStatus === 'unconfigured') return { label: '未配置媒体模型', tone: 'warn' };
  if (note.mediaStatus === 'error') return { label: '媒体识别失败', tone: 'warn' };
  if (note.mediaStatus === 'partial') return { label: '部分识别完成', tone: 'warn' };
  const category = note.aiCategory;
  if (category?.status === 'queued' || category?.status === 'running') return { label: '分类中', tone: 'busy' };
  if (category?.status === 'suggested') return { label: `建议：${category.suggestion ?? '新类别'}`, tone: 'accent' };
  if (category?.status === 'error') return { label: '分类失败', tone: 'warn' };
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
  hideHeader = false,
  batch,
  openRowId = null,
  onOpenRowIdChange,
  onTogglePin,
}: FavoriteListProps) {
  const selecting = batch?.selection.active ?? false;

  const swipeActions = (note: NoteSummaryDto): SwipeAction[] => [
    {
      key: 'pin',
      label: note.pinned ? '取消置顶' : '置顶',
      icon: note.pinned ? <PinOff size={17} /> : <Pin size={17} />,
      testId: `favorite-swipe-pin-${note.id}`,
      onClick: () => onTogglePin?.(note),
    },
    {
      key: 'trash',
      label: '删除',
      icon: <Trash2 size={17} />,
      tone: 'danger',
      testId: `favorite-swipe-trash-${note.id}`,
      onClick: () => batch?.trash([note.id]),
    },
  ];

  return (
    <div className="notes-panel flex h-full flex-col" data-testid="favorite-list">
      {!hideHeader && (
      <div className="notes-header flex shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-foreground">收藏</span>
          <span className="nav-count-chip">{notes.length}</span>
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
      )}

      <div className="chip-scroll flex shrink-0 gap-1 overflow-x-auto px-4 pb-2">
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

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4 mobile-list-scroll">
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
          const status = statusChip(note);
          const platformKey = note.source?.platform ?? 'manual';
          const tint = COVER_TINT[platformKey];
          const CoverIcon = COVER_ICON[platformKey] ?? Bookmark;
          // The server already strips quote/OCR scaffolding from favourite excerpts; the AI
          // summary wins when the note has been analysed.
          const excerpt = note.aiSummary ?? note.excerpt;
          const checked = selecting && (batch?.selection.ids.includes(note.id) ?? false);
          const card = (
            <div
              role="button"
              tabIndex={0}
              onClick={(event) => {
                if (selecting) {
                  hapticTap();
                  batch?.toggle(note.id);
                  return;
                }
                if (event.metaKey || event.ctrlKey) {
                  batch?.toggle(note.id);
                  return;
                }
                onOpen(note.id);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                if (selecting) batch?.toggle(note.id);
                else onOpen(note.id);
              }}
              data-note-id={note.id}
              data-testid={`favorite-item-${note.id}`}
              aria-pressed={selecting ? checked : undefined}
              className={`favorite-card group text-left ${selectedId === note.id ? 'is-selected' : ''} ${
                checked ? 'is-checked' : ''
              }`}
            >
              {selecting && (
                <span className={`favorite-check ${checked ? 'is-checked' : ''}`}>
                  {checked && <Check size={12} strokeWidth={3} />}
                </span>
              )}
              <div className="flex gap-3">
                {note.source?.coverAttachmentId ? (
                  <AuthedImage
                    attachmentId={note.source.coverAttachmentId}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-[10px] object-cover"
                  />
                ) : (
                  <div
                    className="favorite-cover-placeholder h-14 w-14 shrink-0 rounded-[10px]"
                    style={
                      tint
                        ? { color: tint, background: `linear-gradient(150deg, ${tint}29, ${tint}10)` }
                        : {
                            color: 'var(--accent)',
                            background: 'linear-gradient(150deg, var(--accent-soft-strong), var(--accent-soft))',
                          }
                    }
                  >
                    <CoverIcon size={17} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[12px] font-semibold leading-4 text-foreground">{note.title}</div>
                  {excerpt ? (
                    <div className="mt-1 line-clamp-2 text-[10.5px] leading-4 text-muted">{excerpt}</div>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <SourceBadge source={note.source} />
                    {status ? (
                      <span className={`favorite-status favorite-status-${status.tone}`}>
                        {status.tone === 'busy' ? <Loader2 size={9} className="animate-spin" /> : null}
                        {status.label}
                      </span>
                    ) : null}
                    <span className="ml-auto text-[9.5px] tabular-nums text-muted/70">{formatNoteDate(note.createdAt)}</span>
                  </div>
                </div>
              </div>
              {note.aiCategory?.status === 'error' || note.mediaStatus === 'error' ? (
                <span className="mt-1.5 inline-flex items-center gap-1 text-[9.5px] text-danger">
                  <RefreshCw size={9} /> 可在笔记操作中重试
                </span>
              ) : null}
            </div>
          );
          if (!batch) return <div key={note.id}>{card}</div>;
          return (
            <SwipeRow
              key={note.id}
              testId={`favorite-row-${note.id}`}
              className="favorite-swipe-row"
              enabled={!selecting}
              open={openRowId === note.id}
              onOpenChange={(next) => onOpenRowIdChange?.(next ? note.id : null)}
              onCommit={() => batch.trash([note.id])}
              onLeading={() => onTogglePin?.(note)}
              onLongPress={() => batch.enter(note.id)}
              actions={swipeActions(note)}
            >
              {card}
            </SwipeRow>
          );
        })}
      </div>
    </div>
  );
}
