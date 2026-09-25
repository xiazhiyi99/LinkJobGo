'use client';

import { useEffect, useId, useRef, useState } from 'react';

export type CaptchaPayload = {
  provider: string;
  ticket?: string;
  randstr?: string;
  captchaVerifyParam?: string;
  token?: string;
};

type CaptchaChallengeProps = {
  disabled?: boolean;
  onVerified: (payload: CaptchaPayload) => void | Promise<void>;
};

type AliyunCaptchaInstance = { show?: () => void };
type PendingChallenge = {
  resolve: (payload: CaptchaPayload) => void;
  reject: (error: Error) => void;
};

declare global {
  interface Window {
    AliyunCaptchaConfig?: { region: string; prefix: string };
    initAliyunCaptcha?: (options: Record<string, unknown>) => void;
    LingkeCaptcha?: { challenge: () => Promise<CaptchaPayload> };
  }
}

let aliyunScript: Promise<void> | null = null;

function loadAliyunScript() {
  if (aliyunScript) return aliyunScript;
  aliyunScript = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-lingke-aliyun-captcha]');
    if (existing) {
      if (window.initAliyunCaptcha) resolve();
      else existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('验证码脚本加载失败')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';
    script.async = true;
    script.dataset.lingkeAliyunCaptcha = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('验证码脚本加载失败'));
    document.head.appendChild(script);
  });
  return aliyunScript;
}

/**
 * The visible button owns the business action. The provider callback is kept
 * behind this component so AuthForm never depends on Alibaba/Tencent fields.
 * Alibaba's client payload is forwarded unchanged to the API.
 */
export function CaptchaChallenge({ disabled, onVerified }: CaptchaChallengeProps) {
  const provider = (process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER || 'disabled').toLowerCase();
  const instanceId = useId().replace(/:/g, '');
  const instanceRef = useRef<AliyunCaptchaInstance | null>(null);
  const pendingRef = useRef<PendingChallenge | null>(null);
  const onVerifiedRef = useRef(onVerified);
  const [ready, setReady] = useState(provider !== 'aliyun');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  onVerifiedRef.current = onVerified;

  useEffect(() => {
    if (provider !== 'aliyun') return undefined;
    const sceneId = process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID || '';
    const prefix = process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX || '';
    const region = process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_REGION || 'cn';
    if (!sceneId || !prefix) {
      setReady(false);
      setError('人机验证服务尚未配置');
      return undefined;
    }

    let active = true;
    window.AliyunCaptchaConfig = { region, prefix };
    loadAliyunScript().then(() => {
      if (!active || !window.initAliyunCaptcha) return;
      window.initAliyunCaptcha({
        SceneId: sceneId,
        mode: 'popup',
        element: `#${instanceId}-element`,
        button: `#${instanceId}-trigger`,
        success: (captchaVerifyParam: string) => {
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (pending) pending.resolve({ provider: 'aliyun', captchaVerifyParam });
        },
        fail: () => {
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (pending) pending.reject(new Error('安全验证未通过，请重试'));
        },
        getInstance: (instance: AliyunCaptchaInstance) => {
          instanceRef.current = instance;
          setReady(true);
        },
        onError: () => setError('验证码服务暂时不可用，请重试'),
      });
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : '验证码脚本加载失败');
    });
    return () => {
      active = false;
      pendingRef.current?.reject(new Error('验证码已关闭'));
      pendingRef.current = null;
      instanceRef.current = null;
    };
  }, [instanceId, provider]);

  const runChallenge = async () => {
    if (disabled || loading) return;
    setError('');
    setLoading(true);
    try {
      let payload: CaptchaPayload;
      if (provider === 'aliyun') {
        if (!ready || !instanceRef.current?.show) throw new Error('验证码正在加载，请稍后重试');
        payload = await new Promise<CaptchaPayload>((resolve, reject) => {
          pendingRef.current = { resolve, reject };
          instanceRef.current?.show?.();
        });
      } else if (provider === 'disabled' && process.env.NODE_ENV !== 'production') {
        payload = { provider: 'disabled', token: 'development' };
      } else {
        const adapter = window.LingkeCaptcha;
        if (!adapter?.challenge) throw new Error('人机验证服务尚未配置');
        payload = await adapter.challenge();
      }
      await onVerifiedRef.current(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '验证未完成，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-captcha-control">
      <div id={`${instanceId}-element`} className="auth-captcha-element" aria-hidden="true" />
      <button id={`${instanceId}-trigger`} className="auth-captcha-sdk-trigger" type="button" tabIndex={-1} aria-hidden="true" />
      <button className="auth-code-button" type="button" onClick={runChallenge} disabled={disabled || loading || (provider === 'aliyun' && !ready)}>
        {loading ? '验证中…' : '发送验证码'}
      </button>
      {error && <span className="auth-captcha-error" role="alert">{error}</span>}
    </div>
  );
}
