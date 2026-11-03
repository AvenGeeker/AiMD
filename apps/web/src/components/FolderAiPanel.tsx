import { useEffect, useState } from 'react';
import { Bot, Compass, ExternalLink, Loader2, Search, Send, Sparkles, X } from 'lucide-react';
import type { FolderQueryDto, FolderQueryMode, NoteSummaryDto } from '@aimarkdown/shared';
import { describeError } from '../lib/api.js';
import { useAiOverview, useCreateFolderQuery, useFolderQuery } from '../lib/queries.js';

interface Props {
  open: boolean;
  folderId: string | null;
  folderName: string;
  onClose(): void;
  onOpenNote(id: string): void;
  onSaveNote(input: { title: string; body: string }): Promise<void>;
}

interface Turn {
  question: string;
  answer: string;
  query: FolderQueryDto | null;
}

const MODES: Array<{ value: FolderQueryMode; label: string; icon: typeof Bot; hint: string }> = [
  { value: 'qa', label: '问答', icon: Bot, hint: '基于收藏内容回答问题，并给出引用。' },
  { value: 'search', label: '查询', icon: Search, hint: '按自然语言找出相关收藏，并给出简要结论。' },
  { value: 'trip', label: '出行规划', icon: Compass, hint: '从游记和攻略生成按天行程、预算与准备清单。' },
];

function CitationCard({ note, onOpen }: { note: NoteSummaryDto; onOpen(): void }) {
  return (
    <button type="button" className="favorite-citation" onClick={onOpen} data-note-id={note.id}>
      <span className="truncate">{note.title}</span>
      <ExternalLink size={10} className="shrink-0" />
    </button>
  );
}

export function FolderAiPanel({ open, folderId, folderName, onClose, onOpenNote, onSaveNote }: Props) {
  const overview = useAiOverview(open);
  const create = useCreateFolderQuery();
  const [mode, setMode] = useState<FolderQueryMode>('qa');
  const [question, setQuestion] = useState('');
  const [allowWeb, setAllowWeb] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [queryId, setQueryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useFolderQuery(queryId);
  const webConfigured = Boolean(overview.data?.config?.webSearchMode && overview.data.config.webSearchMode !== 'none');
  const activeMode = MODES.find((item) => item.value === mode)!;

  useEffect(() => {
    if (!open) {
      setQuestion('');
      setTurns([]);
      setQueryId(null);
      setError(null);
      setMode('qa');
      setAllowWeb(false);
    }
  }, [open]);

  useEffect(() => {
    setAllowWeb(mode === 'trip' && webConfigured);
  }, [mode, webConfigured]);

  useEffect(() => {
    const result = query.data?.query;
    if (!result || !queryId) return;
    if (result.status !== 'done' && result.status !== 'error' && result.status !== 'cancelled') return;
    setTurns((prev) => {
      const index = prev.findIndex((turn) => turn.query?.id === result.id);
      if (index < 0) return prev;
      const next = [...prev];
      next[index] = { ...next[index]!, answer: result.answer, query: result };
      return next;
    });
    if (result.status === 'error') setError(result.error ?? 'AI 查询失败');
  }, [query.data, queryId]);

  const submit = async () => {
    if (!folderId || !question.trim()) return;
    setError(null);
    const text = question.trim();
    setQuestion('');
    setTurns((prev) => [...prev, { question: text, answer: '', query: null }]);
    try {
      const history = turns.flatMap((turn) => [
        { role: 'user' as const, content: turn.question },
        ...(turn.answer ? [{ role: 'assistant' as const, content: turn.answer }] : []),
      ]);
      const result = await create.mutateAsync({
        folderId,
        input: { mode, question: text, allowWebSearch: allowWeb && webConfigured, history },
      });
      setQueryId(result.query.id);
      setTurns((prev) => {
        const next = [...prev];
        const index = next.findIndex((turn) => turn.question === text && !turn.query);
        if (index >= 0) next[index] = { ...next[index]!, query: result.query };
        return next;
      });
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const latest = query.data?.query;
  const latestTurn = turns[turns.length - 1];
  const busy = latest ? latest.status === 'queued' || latest.status === 'running' : create.isPending;
  const answer = latestTurn?.answer || latest?.answer || '';

  if (!open) return null;
  return (
    <div className="folder-ai-backdrop" role="presentation">
      <aside className="folder-ai-panel" role="dialog" aria-label="文件夹 AI">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={15} className="text-accent" /> 问 AI</div>
            <div className="truncate text-[10.5px] text-muted">{folderName}</div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>

        <div className="border-b border-border-subtle px-4 py-2.5">
          <div className="flex gap-1">
            {MODES.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.value} type="button" className={`chip !min-h-7 flex-1 text-[10px] ${mode === item.value ? 'is-active' : ''}`} onClick={() => setMode(item.value)}>
                  <Icon size={11} /> {item.label}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[9.5px] text-muted">
            <span>{activeMode.hint}</span>
            <label className={`flex shrink-0 items-center gap-1.5 ${webConfigured ? '' : 'opacity-45'}`}>
              <input type="checkbox" checked={allowWeb} disabled={!webConfigured} onChange={(event) => setAllowWeb(event.target.checked)} />
              联网
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {turns.length === 0 ? (
            <div className="rounded-xl border border-border-subtle bg-panel/45 p-4 text-[11px] leading-6 text-muted">
              <div className="font-medium text-foreground">基于「{folderName}」提问</div>
              <p className="mt-1">例如：这个文件夹里有哪些适合周末去的地方？帮我总结最近收藏的 AI 文章，或规划三天行程。</p>
            </div>
          ) : null}
          {turns.map((turn, index) => (
            <div key={`${turn.question}-${index}`} className="space-y-2">
              <div className="ml-auto max-w-[90%] rounded-xl rounded-br-sm bg-accent-soft px-3 py-2 text-[11px] leading-5 text-foreground">{turn.question}</div>
              {turn.answer || (busy && index === turns.length - 1) ? (
                <div className="rounded-xl rounded-bl-sm border border-border-subtle bg-panel/55 px-3 py-2.5 text-[11px] leading-5 text-foreground">
                  {turn.answer ? <div className="whitespace-pre-wrap">{turn.answer}</div> : <div className="flex items-center gap-2 text-muted"><Loader2 size={12} className="animate-spin" /> {latest?.status === 'queued' ? '排队中…' : '正在筛选收藏并生成回答…'}</div>}
                  {turn.query?.webSources?.length ? (
                    <div className="mt-2 space-y-1 border-t border-border-subtle pt-2">
                      <div className="text-[9.5px] font-medium text-muted">联网来源</div>
                      {turn.query.webSources.map((source) => (
                        <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block truncate text-[10px] text-accent hover:underline">{source.title}</a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {turn.query?.citations?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {turn.query.citations.map((note) => <CitationCard key={note.id} note={note} onOpen={() => onOpenNote(note.id)} />)}
                </div>
              ) : null}
            </div>
          ))}
          {error ? <div className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[10.5px] text-danger">{error}</div> : null}
          {latest?.truncated ? <div className="text-[9.5px] text-warning">收藏较多，本次只分析了最近的一部分；缩小到子目录可提高覆盖。</div> : null}
        </div>

        <div className="border-t border-border-subtle p-3">
          {answer ? (
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                className="button-secondary !min-h-7 !px-2.5 text-[10px]"
                onClick={() => void onSaveNote({
                  title: mode === 'trip' ? `出行规划 · ${new Date().toLocaleDateString('zh-CN')}` : `AI 回答 · ${folderName}`,
                  body: answer,
                })}
              >
                保存为笔记
              </button>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={2} placeholder={`向「${folderName}」提问…`} className="input-base min-h-10 flex-1 resize-none text-xs" onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit(); }} />
            <button type="button" className="button-primary !h-10 !w-10 !p-0" onClick={() => void submit()} disabled={!question.trim() || busy} aria-label="发送">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
