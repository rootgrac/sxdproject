import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollectionView, collectionProgress } from '../../../client/assets/scripts/modules/collection/collection-core.ts';
import type { CollectionSet } from '../../../client/assets/scripts/modules/collection/collection-core.ts';

test('图鉴进度计算', () => {
  const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const p = collectionProgress(new Set(['a', 'b']), all);
  assert.equal(p.owned, 2);
  assert.equal(p.total, 4);
  assert.equal(p.pct, 50);
  assert.equal(collectionProgress(new Set(), []).pct, 0);
});

test('多收藏集视图（伙伴/装备/命格）', () => {
  const sets: CollectionSet[] = [
    { key: 'partner', title: '伙伴', entries: [{ id: 'u101', name: '白纾' }, { id: 'u102', name: '陆沉舟' }] },
    { key: 'equip', title: '装备', entries: [{ id: 'eq_w1', name: '青锋剑' }] },
  ];
  const view = buildCollectionView(sets, new Set(['u101', 'eq_w1']));
  assert.equal(view[0].progress.pct, 50);
  assert.equal(view[0].entries[0].owned, true);
  assert.equal(view[1].progress.pct, 100);
});
