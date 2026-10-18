'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { WorkspaceHeader } from '../../../../components/workspace/WorkspaceHeader';
import { getProfile, updateProfile, type ProfilePayload } from '../../../../features/profile/profile-api';
import { homepageCardUpdate, readHomepageCard, type HomepageCard } from '../../../../features/profile/homepage-card';

export default function PersonalHomePage() {
  const [payload, setPayload] = useState<ProfilePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const data = useMemo(() => readHomepageCard(payload), [payload]);
  const [draft, setDraft] = useState<HomepageCard>(data);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const headlineRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getProfile().then((result) => {
      if (!cancelled) setPayload(result);
    }).catch(() => { if (!cancelled) setError('个人主页读取失败，请刷新后重试。'); }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (editing) headlineRef.current?.focus(); }, [editing]);

  function startEditing() {
    setDraft(data); setSaved(false); setEditing(true);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setSaved(false);
    try {
      // Read the latest extra fields so editing this card keeps other profile data.
      const latest = await getProfile();
      const result = await updateProfile(homepageCardUpdate(latest, draft));
      setPayload({ ...latest, ...result }); setEditing(false); setSaved(true);
    } catch (error) { setError(error instanceof Error ? error.message : '保存失败，请重试。'); }
    finally { setSaving(false); }
  }

  return <div className="workspace-content profile-home-page">
    <WorkspaceHeader title="个人主页" />
    <main className="profile-public" aria-busy={isLoading}>
      <section className="profile-hero">
        <div className="profile-cover"><div className="profile-cover-orb" /><div className="profile-cover-lines" /></div>
        <div className="profile-identity-card">
          <div className="profile-avatar profile-hero-portrait">{data.displayName.slice(0, 1) || '我'}</div>
          <div className="profile-identity-main">
            <span className="profile-overline">领客个人主页</span>
            <h1>{data.displayName || '未填写姓名'}</h1>
            <p>{data.headline || '写一句话介绍自己'} <span>·</span> 领客求职者</p>
            <div className="profile-location">{data.location || '未填写所在城市'}</div>
            <div className="profile-hero-actions">
              {!editing && <button type="button" className="profile-primary-action" disabled={isLoading || Boolean(error)} onClick={startEditing}>编辑签名</button>}
              {saved && <span className="profile-card-saved" role="status">主页信息已保存</span>}
            </div>
            {error && <p className="profile-card-error" role="alert">{error}</p>}
            {editing && <form className="profile-card-editor" onSubmit={save}>
              <div className="profile-card-editor-heading"><h2>编辑主页信息卡</h2><p>这些信息展示在个人主页，不会修改简历资料。</p></div>
              <label>显示姓名<input value={draft.displayName} maxLength={80} disabled={saving} onChange={event => setDraft(value => ({ ...value, displayName: event.target.value }))}/></label>
              <label>所在城市<input value={draft.location} maxLength={100} disabled={saving} placeholder="如：上海" onChange={event => setDraft(value => ({ ...value, location: event.target.value }))}/></label>
              <label className="profile-card-editor-full">个性签名<input ref={headlineRef} value={draft.headline} maxLength={160} disabled={saving} placeholder="用一句话介绍自己" onChange={event => setDraft(value => ({ ...value, headline: event.target.value }))}/></label>
              <label className="profile-card-editor-full">个人描述<textarea value={draft.description} maxLength={4000} rows={4} disabled={saving} placeholder="介绍你的兴趣、经历或正在做的事" onChange={event => setDraft(value => ({ ...value, description: event.target.value }))}/></label>
              <div className="profile-card-editor-actions"><button type="button" className="profile-secondary-action" disabled={saving} onClick={() => { setEditing(false); setError(''); }}>取消</button><button type="submit" className="profile-primary-action" disabled={saving}>{saving ? '保存中…' : '保存信息'}</button></div>
            </form>}
          </div>
        </div>
      </section>

      <div className="profile-home-grid">
        <section className="profile-about-card">
          <div className="profile-card-heading"><div><span className="profile-overline">个人描述</span><h2>关于我</h2></div><button type="button" className="profile-text-action" disabled={isLoading || editing || Boolean(error)} onClick={startEditing}>编辑</button></div>
          <p>{data.description || '还没有填写个人描述。'}</p>
        </section>
      </div>
    </main>
  </div>;
}
