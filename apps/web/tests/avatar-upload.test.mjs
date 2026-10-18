import assert from 'node:assert/strict';
import test from 'node:test';
import { AVATAR_FILE_LIMIT, validateAvatarFile } from '../features/profile/avatar-upload.ts';
import { homepageCardUpdate, readHomepageCard, safeAvatarUrl } from '../features/profile/homepage-card.ts';

test('avatar selection accepts supported raster types and rejects empty, large or unsupported files', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.doesNotThrow(() => validateAvatarFile({ type, size: 1024 }));
  assert.doesNotThrow(() => validateAvatarFile({ type: 'image/png', size: AVATAR_FILE_LIMIT }));
  assert.throws(() => validateAvatarFile({ type: 'image/png', size: AVATAR_FILE_LIMIT + 1 }), /5 MB/);
  assert.throws(() => validateAvatarFile({ type: 'image/png', size: 0 }), /为空/);
  assert.throws(() => validateAvatarFile({ type: 'image/svg+xml', size: 1024 }), /JPG/);
});

test('avatar sources accept raster data and web links but exclude executable or temporary sources', () => {
  assert.equal(safeAvatarUrl('data:image/webp;base64,UklGRg=='), 'data:image/webp;base64,UklGRg==');
  assert.equal(safeAvatarUrl('https://example.com/avatar.png'), 'https://example.com/avatar.png');
  for (const source of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'blob:https://example.com/temp', '']) assert.equal(safeAvatarUrl(source), '');
});

test('homepage avatar upload and removal survive reload without changing the resume photo', () => {
  const payload = { profile: { avatarUrl: 'https://example.com/resume-photo.png', extra: { note: 'keep' } } };
  const draft = { ...readHomepageCard(payload), avatarUrl: 'data:image/webp;base64,UklGRg==' };
  const uploaded = homepageCardUpdate(payload, draft);
  assert.equal(uploaded.profile.homepage.avatarUrl, draft.avatarUrl);
  assert.equal(Object.hasOwn(uploaded.profile, 'avatarUrl'), false);
  const reloaded = { profile: { ...payload.profile, extra: uploaded.profile } };
  assert.equal(readHomepageCard(reloaded).avatarUrl, draft.avatarUrl);
  const removed = homepageCardUpdate(reloaded, { ...readHomepageCard(reloaded), avatarUrl: '' });
  assert.equal(readHomepageCard({ profile: { ...payload.profile, extra: removed.profile } }).avatarUrl, '');
  assert.equal(removed.profile.note, 'keep');
  assert.equal(payload.profile.avatarUrl, 'https://example.com/resume-photo.png');
});
