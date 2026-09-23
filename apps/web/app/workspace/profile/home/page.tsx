'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { WorkspaceHeader } from '../../../../components/workspace/WorkspaceHeader';
import { getProfile, type ProfilePayload } from '../../../../features/profile/profile-api';
import { routes } from '../../../../lib/routes';

const textValue = (value: unknown) => Array.isArray(value) ? value.join('、') : value == null ? '' : String(value);

function readProfile(payload: ProfilePayload | null) {
  const source = ((payload as Record<string, unknown> | null)?.data as ProfilePayload | undefined) || payload || {};
  const profile = (((source as ProfilePayload).profile || source) || {}) as Record<string, unknown>;
  const preferences = ((source as ProfilePayload).preferences || {}) as Record<string, unknown>;
  const displayName = textValue(profile.name) || '林同学';
  const headline = textValue(preferences.targetTitles) || '把经历整理成下一次机会';
  const location = textValue(profile.city || profile.homeCity) || '中国 · 开放求职中';
  const description = textValue(profile.selfIntroduction);
  return { displayName, headline, location, description };
}

export default function PersonalHomePage() {
  const [payload, setPayload] = useState<ProfilePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const data = useMemo(() => readProfile(payload), [payload]);

  useEffect(() => {
    let cancelled = false;
    getProfile().then((result) => {
      if (!cancelled) setPayload(result);
    }).catch(() => undefined).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return <div className="workspace-content profile-home-page">
    <WorkspaceHeader title="个人主页" />
    <main className="profile-public" aria-busy={isLoading}>
      <section className="profile-hero">
        <div className="profile-cover"><div className="profile-cover-orb" /><div className="profile-cover-lines" /></div>
        <div className="profile-identity-card">
          <div className="profile-avatar profile-hero-portrait">{data.displayName.slice(0, 1)}</div>
          <div className="profile-identity-main">
            <span className="profile-overline">领客个人主页</span>
            <h1>{data.displayName}</h1>
            <p>{data.headline} <span>·</span> 领客求职者</p>
            <div className="profile-location">{data.location}</div>
            <div className="profile-hero-actions">
              <Link className="profile-primary-action" href={routes.profile}>编辑主页</Link>
            </div>
          </div>
        </div>
      </section>

      <div className="profile-home-grid">
        <section className="profile-about-card">
          <div className="profile-card-heading"><div><span className="profile-overline">个人描述</span><h2>关于我</h2></div><Link className="profile-text-action" href={routes.profile}>编辑</Link></div>
          <p>{data.description || '还没有填写个人描述。'}</p>
        </section>
      </div>
    </main>
  </div>;
}
