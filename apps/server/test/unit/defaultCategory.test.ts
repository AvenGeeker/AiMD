import { describe, expect, it } from 'vitest';
import { pickDefaultFavoriteCategory } from '../../src/favorites/defaultCategory.js';

const folders = [
  { id: 'inbox', name: '待分类' },
  { id: 'travel', name: '旅游' },
  { id: 'ai', name: 'AI' },
  { id: 'model', name: '大模型' },
  { id: 'other', name: '其他' },
  { id: 'xhs', name: '小红书' },
];

describe('default favourite category', () => {
  it('prefers an explicit platform folder', () => {
    expect(pickDefaultFavoriteCategory({
      platform: 'xiaohongshu',
      title: '大理旅行攻略',
      body: '',
      folders,
      inboxFolderId: 'inbox',
    })).toEqual({ folderId: 'xhs', name: '小红书' });
  });

  it('uses content keywords when there is no platform folder', () => {
    expect(pickDefaultFavoriteCategory({
      platform: 'web',
      title: '云南旅行行程安排',
      body: '大理、丽江和香格里拉的路线与酒店。',
      folders: folders.filter((folder) => folder.id !== 'xhs'),
      inboxFolderId: 'inbox',
    })).toEqual({ folderId: 'travel', name: '旅游' });
  });

  it('prefers the more specific 大模型 category over the broad AI category', () => {
    expect(pickDefaultFavoriteCategory({
      platform: 'web',
      title: '本地部署大模型',
      body: '使用 llama.cpp 运行模型。',
      folders,
      inboxFolderId: 'inbox',
    })).toEqual({ folderId: 'model', name: '大模型' });
  });

  it('never selects the system inbox and falls back to 其他', () => {
    expect(pickDefaultFavoriteCategory({
      platform: 'douyin',
      title: '随手记一下',
      body: '今天天气不错。',
      folders,
      inboxFolderId: 'inbox',
    })).toEqual({ folderId: 'other', name: '其他' });
  });

  it('asks the caller to create 其他 when even that folder is missing', () => {
    expect(pickDefaultFavoriteCategory({
      platform: 'manual',
      title: '随手记一下',
      body: '',
      folders: [{ id: 'inbox', name: '待分类' }],
      inboxFolderId: 'inbox',
    })).toEqual({ folderId: null, name: '其他' });
  });
});
