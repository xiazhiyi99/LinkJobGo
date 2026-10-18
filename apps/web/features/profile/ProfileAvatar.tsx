'use client';

import { useState } from 'react';
import { safeAvatarUrl } from './homepage-card';

export function ProfileAvatar({ url, name }: { url: string; name: string }) {
  const [failedUrl, setFailedUrl] = useState('');
  const source = safeAvatarUrl(url);
  return source && source !== failedUrl
    ? <img src={source} alt={`${name || '我'}的头像`} onError={() => setFailedUrl(source)}/>
    : <span>{name.slice(0, 1) || '我'}</span>;
}
