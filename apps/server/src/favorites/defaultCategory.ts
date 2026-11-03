import type { SourcePlatform } from '@aimarkdown/shared';

export interface CategoryFolder {
  id: string;
  name: string;
}

export interface DefaultCategoryChoice {
  folderId: string | null;
  name: string;
}

interface CategoryRule {
  /** Folder names this rule may use. The first matching existing folder wins. */
  names: string[];
  /** Title/body signals, strongest first. ASCII keywords use word boundaries. */
  keywords: string[];
}

const PLATFORM_FOLDER_NAMES: Record<SourcePlatform, string[]> = {
  xiaohongshu: ['小红书', '小红书收藏'],
  douyin: ['抖音', '抖音收藏'],
  wechat: ['公众号', '微信公众号', '微信'],
  web: ['网页', '网页收藏', '网站'],
  manual: ['手动', '手动收藏'],
};

const CATEGORY_RULES: CategoryRule[] = [
  {
    names: ['大模型'],
    keywords: ['大模型', 'llm', 'gpt', 'chatgpt', 'claude', 'deepseek', 'gemini', 'qwen', 'transformer'],
  },
  {
    names: ['AI'],
    keywords: ['人工智能', 'ai', 'aigc', 'agent', '提示词', '机器学习', '深度学习', 'comfyui', 'stable diffusion'],
  },
  {
    names: ['学习'],
    keywords: [
      '学习', '教程', '课程', '读书', '读书笔记', '考试', '知识', '方法论',
      'obsidian', 'notion', 'anki', '记忆法',
    ],
  },
  {
    names: ['旅游'],
    keywords: [
      '旅游', '旅行', '攻略', '行程', '景点', '酒店', '民宿', '机票', '自驾', '签证',
      '露营', '徒步', '大理', '丽江', '云南', '三亚', '川西', '新疆', '西藏',
    ],
  },
  {
    names: ['购物'],
    keywords: [
      '购物', '好物', '种草', '测评', '开箱', '优惠', '折扣', '下单', '入手', '值得买',
      '价格', '淘宝', '京东', '拼多多', '双十一', '618',
    ],
  },
  {
    names: ['职场'],
    keywords: [
      '职场', '工作', '面试', '简历', '求职', '同事', '老板', '管理', '会议', '汇报',
      '跳槽', '副业', '效率', '时间管理',
    ],
  },
  {
    names: ['健康'],
    keywords: [
      '健康', '健身', '运动', '减肥', '养生', '饮食', '睡眠', '瑜伽', '跑步', '医疗',
      '医院', '医生', '体检',
    ],
  },
  {
    names: ['生活'],
    keywords: [
      '生活', '日常', '美食', '做饭', '菜谱', '家居', '装修', '宠物', '育儿', '收纳',
      '清洁', '穿搭', '护肤',
    ],
  },
];

const FALLBACK_CATEGORY = '其他';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Match ASCII keywords as words so "ai" does not match inside "detail" or "email". */
function containsKeyword(text: string, keyword: string): boolean {
  if (/^[a-z0-9.+#-]+$/.test(keyword)) {
    return new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text);
  }
  return text.includes(keyword);
}

function findFolder(folders: CategoryFolder[], names: string[]): CategoryFolder | null {
  const wanted = new Set(names.map(normalize));
  return folders.find((folder) => wanted.has(normalize(folder.name))) ?? null;
}

/**
 * Choose the category shown immediately after saving a favourite.
 *
 * The goal is never to leave a fresh save in the system 待分类 folder. We first honour an
 * explicit platform folder (some users organise 小红书/抖音/公众号 into their own folders), then
 * fall back to lightweight keyword matching over the preset categories, and finally 其他.
 * The AI classifier can still refine the choice later.
 */
export function pickDefaultFavoriteCategory(input: {
  platform: SourcePlatform;
  title: string;
  body: string;
  folders: CategoryFolder[];
  inboxFolderId: string | null;
}): DefaultCategoryChoice {
  const folders = input.folders.filter((folder) => folder.id !== input.inboxFolderId);
  const platformFolder = findFolder(folders, PLATFORM_FOLDER_NAMES[input.platform]);
  if (platformFolder) return { folderId: platformFolder.id, name: platformFolder.name };

  const title = normalize(input.title);
  const body = normalize(input.body);
  let best: { folder: CategoryFolder; score: number } | null = null;
  for (const rule of CATEGORY_RULES) {
    const folder = findFolder(folders, rule.names);
    if (!folder) continue;
    let score = 0;
    for (const keyword of rule.keywords) {
      if (containsKeyword(title, keyword)) score += 2;
      if (containsKeyword(body, keyword)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { folder, score };
    }
  }
  if (best) return { folderId: best.folder.id, name: best.folder.name };

  const fallback = findFolder(folders, [FALLBACK_CATEGORY]);
  return { folderId: fallback?.id ?? null, name: fallback?.name ?? FALLBACK_CATEGORY };
}
