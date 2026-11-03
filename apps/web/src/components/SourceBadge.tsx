import { Bookmark, Globe2, MessageCircle, Music2 } from 'lucide-react';
import type { NoteSourceDto } from '@aimarkdown/shared';

const LABELS: Record<string, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  wechat: '公众号',
  web: '网页',
  manual: '手动',
};

export function SourceBadge({ source }: { source: NoteSourceDto | null }) {
  if (!source) return null;
  const platform = source.platform ?? 'manual';
  const Icon = platform === 'douyin' ? Music2 : platform === 'wechat' ? MessageCircle : platform === 'web' ? Globe2 : Bookmark;
  return (
    <span className={`source-badge source-${platform}`}>
      <Icon size={10} />
      {LABELS[platform] ?? '收藏'}
      {source.author ? <span className="max-w-24 truncate opacity-75">· {source.author}</span> : null}
    </span>
  );
}
