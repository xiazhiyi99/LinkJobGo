import assert from 'node:assert/strict';
import test from 'node:test';
import { homepageCardUpdate, readHomepageCard } from '../features/profile/homepage-card.ts';

const resume = {
  profile: { name: '简历姓名', city: '北京', selfIntroduction: '简历描述', extra: { customNote: '保留资料', homepage: { headline: '原有签名' } } },
  preferences: { targetTitles: '软件工程师' },
};

test('existing resume information supplies initial card values and homepage overrides take precedence', () => {
  assert.deepEqual(readHomepageCard(resume), { displayName: '简历姓名', headline: '原有签名', location: '北京', description: '简历描述' });
  assert.equal(readHomepageCard({ profile: { name: '姓名' }, preferences: { targetTitles: ['研发', '产品'] } }).headline, '研发、产品');
  assert.equal(readHomepageCard({ data: resume }).headline, '原有签名');
});

test('saving the card preserves unrelated extra data and does not write resume fields or preferences', () => {
  const draft = { displayName: ' 主页姓名 ', headline: ' 新签名 ', location: '上海', description: '主页描述' };
  const update = homepageCardUpdate(resume, draft);
  assert.deepEqual(update, { profile: { customNote: '保留资料', homepage: { ...draft, displayName: '主页姓名', headline: '新签名' } } });
  assert.equal(resume.profile.name, '简历姓名');
  assert.equal(resume.preferences.targetTitles, '软件工程师');
  assert.equal(Object.hasOwn(update.profile, 'name'), false);
  assert.equal(Object.hasOwn(update, 'preferences'), false);
});

test('cleared optional fields remain cleared after saving and reloading', () => {
  const update = homepageCardUpdate(resume, { displayName: '主页姓名', headline: '', location: '', description: '' });
  const reloaded = { ...resume, profile: { ...resume.profile, extra: update.profile } };
  assert.deepEqual(readHomepageCard(reloaded), { displayName: '主页姓名', headline: '', location: '', description: '' });
});
