import test from 'node:test';
import assert from 'node:assert/strict';
import { dateFieldDisplay, selectFieldOptions } from '../features/profile/field-display.ts';
import { profileSectionUpdate } from '../features/profile/profile-section-update.ts';

test('existing month and day dates display at their actual precision', () => {
  assert.deepEqual(dateFieldDisplay('2022-09'), { type: 'month', value: '2022-09' });
  assert.deepEqual(dateFieldDisplay('2024-06-17', 'month'), { type: 'date', value: '2024-06-17' });
  assert.deepEqual(dateFieldDisplay('1999-06-15'), { type: 'date', value: '1999-06-15' });
});

test('blank experience dates use months while birthday and availability keep day precision', () => {
  assert.deepEqual(dateFieldDisplay('', 'month'), { type: 'month', value: '' });
  assert.deepEqual(dateFieldDisplay(''), { type: 'date', value: '' });
});

test('common date spellings normalize for display without inventing a day or shifting timezones', () => {
  for (const raw of ['2022/9', '2022.09', '2022年9月']) assert.deepEqual(dateFieldDisplay(raw), { type: 'month', value: '2022-09' });
  for (const raw of ['2024/6/7', '2024年6月7日', '2024-06-07T00:00:00.000+08:00']) assert.deepEqual(dateFieldDisplay(raw), { type: 'date', value: '2024-06-07' });
});

test('year-only, ongoing, unknown and invalid date values remain visible as original text', () => {
  for (const raw of ['2020', '至今', '待确认', '2024-13', '2023-02-29', '2024-04-31', '0000-01', '2024-00', '2024-01-00']) assert.deepEqual(dateFieldDisplay(raw), { type: 'text', value: raw });
  assert.deepEqual(dateFieldDisplay('2024-02-29'), { type: 'date', value: '2024-02-29' });
});

test('degree aliases and custom select values remain selected without changing the canonical options', () => {
  const choices = ['请选择学历', '大专', '本科', '硕士', '博士'];
  for (const value of ['硕士研究生', '大学本科', '直博生', '其他学历']) {
    const options = selectFieldOptions(value, choices);
    assert.deepEqual(options[0], { value, label: value });
    assert.ok(options.some(option => option.value === '硕士'));
  }
  assert.equal(choices.length, 5);
  assert.equal(selectFieldOptions('硕士', choices).filter(option => option.value === '硕士').length, 1);
});

test('empty select values do not silently display a different first option', () => {
  assert.deepEqual(selectFieldOptions('', ['论文', '专利'])[0], { value: '', label: '请选择' });
  assert.deepEqual(selectFieldOptions('', ['请选择水平', '母语'])[0], { value: '', label: '请选择水平' });
  assert.equal(selectFieldOptions('日常会话', ['请选择水平', '熟练'])[0].value, '日常会话');
});

test('display adaptation does not rewrite originals when a record is opened or another field is edited', () => {
  const section = { title: '教育经历', kind: 'repeat', fields: [{ key: 'school' }, { key: 'degree' }, { key: 'startDate' }, { key: 'endDate' }] };
  const original = { id: 'education-a', school: '测试大学', degree: '硕士研究生', startDate: '2022/09', endDate: '2024-06-17' };
  dateFieldDisplay(original.startDate); selectFieldOptions(original.degree, ['请选择学历', '硕士']);
  assert.deepEqual(profileSectionUpdate(section, {}, {}, [{ ...original }], [original]), { records: { 教育经历: [{ id: original.id }] } });
  assert.deepEqual(profileSectionUpdate(section, {}, {}, [{ ...original, school: '新学校' }], [original]), { records: { 教育经历: [{ id: original.id, school: '新学校' }] } });
});

test('explicitly editing or clearing a date/select sends only the intended field', () => {
  const section = { title: '教育经历', kind: 'repeat', fields: [{ key: 'degree' }, { key: 'startDate' }] };
  const original = { id: 'education-a', degree: '大学本科', startDate: '2018-09' };
  assert.deepEqual(profileSectionUpdate(section, {}, {}, [{ ...original, startDate: '2018-10' }], [original]), { records: { 教育经历: [{ id: original.id, startDate: '2018-10' }] } });
  assert.deepEqual(profileSectionUpdate(section, {}, {}, [{ ...original, degree: '', startDate: '' }], [original]), { records: { 教育经历: [{ id: original.id, degree: '', startDate: '' }] } });
});
