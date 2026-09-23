#!/usr/bin/env python3
"""Small stdlib-only IMAP reader. Credentials are accepted only on stdin."""
import email, email.header, email.utils, html, imaplib, json, re, smtplib, ssl, sys
from datetime import date, datetime, timedelta, timezone

def decode(value):
    if not value: return ''
    try: return str(email.header.make_header(email.header.decode_header(value)))
    except Exception: return str(value)

def body_text(message):
    plain, markup = '', ''
    parts = message.walk() if message.is_multipart() else [message]
    for part in parts:
        if 'attachment' in str(part.get('Content-Disposition', '')).lower(): continue
        if part.get_content_type() not in ('text/plain', 'text/html'): continue
        value = (part.get_payload(decode=True) or b'').decode(part.get_content_charset() or 'utf-8', errors='replace')
        if part.get_content_type() == 'text/plain' and not plain: plain = value
        if part.get_content_type() == 'text/html' and not markup: markup = value
    links = []
    for match in re.finditer(r'<a\b[^>]*\bhref\s*=\s*(["\'])(.*?)\1', markup or '', re.I | re.S):
        href = html.unescape(match.group(2)).strip()
        if re.match(r'https?://', href, re.I) and href not in links: links.append(href)
    if plain:
        missing = [url for url in links if url not in plain]
        return plain + (('\n' + '\n'.join('链接: ' + url for url in missing)) if missing else '')
    text = re.sub(r'<(?:script|style|noscript|svg|canvas)\b[^>]*>[\s\S]*?</(?:script|style|noscript|svg|canvas)\s*>', ' ', markup or '', flags=re.I)
    text = html.unescape(re.sub(r'<[^>]+>', ' ', text))
    text = re.sub(r'\s+', ' ', text).strip()
    return text + (('\n' + '\n'.join('链接: ' + url for url in links)) if links else '')

def run(request):
    selected = request.get('provider') or {}
    host, port = selected.get('imapHost'), int(selected.get('imapPort') or 993)
    if not host: raise ValueError('邮箱 IMAP 服务地址未配置')
    days = int(request.get('rangeDays') or 7); end = date.today(); start = end - timedelta(days=max(days - 1, 0))
    client = imaplib.IMAP4_SSL(host, port, timeout=20); messages = []
    try:
        client.login(request['email'], request['secret']); status, _ = client.select('INBOX', readonly=True)
        if status != 'OK': raise RuntimeError('邮箱收件箱不可用')
        status, data = client.uid('search', None, 'SINCE', start.strftime('%d-%b-%Y'), 'BEFORE', (end + timedelta(days=1)).strftime('%d-%b-%Y'))
        if status != 'OK': raise RuntimeError('邮箱搜索失败')
        for uid in list(reversed((data[0] or b'').split()))[:500]:
            status, payload = client.uid('fetch', uid, '(BODY.PEEK[])')
            if status != 'OK' or not payload or not isinstance(payload[0], tuple): continue
            parsed = email.message_from_bytes(payload[0][1]); received = email.utils.parsedate_to_datetime(parsed.get('Date', '')) if parsed.get('Date') else datetime.now(timezone.utc)
            if received.tzinfo is None: received = received.replace(tzinfo=timezone.utc)
            body = body_text(parsed)
            messages.append({'providerMessageId': decode(parsed.get('Message-ID')) or 'imap:' + uid.decode(), 'threadId': decode(parsed.get('References')), 'fromName': decode(parsed.get('From')), 'subject': decode(parsed.get('Subject')) or '(无主题)', 'receivedAt': received.astimezone(timezone.utc).isoformat(), 'snippet': re.sub(r'\s+', ' ', body).strip()[:1000], 'body': body})
    finally:
        try: client.logout()
        except Exception: pass
    if request.get('verifySmtp') and selected.get('smtpHost'):
        smtp = None
        try:
            smtp_host, smtp_port = selected.get('smtpHost'), int(selected.get('smtpPort') or 465)
            smtp = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=20) if smtp_port == 465 else smtplib.SMTP(smtp_host, smtp_port, timeout=20)
            if smtp_port != 465: smtp.starttls(context=ssl.create_default_context())
            smtp.login(request['email'], request['secret'])
        finally:
            if smtp is not None:
                try: smtp.quit()
                except Exception: pass
    return {'messages': messages}

try:
    print(json.dumps(run(json.load(sys.stdin)), ensure_ascii=False))
except Exception:
    print(json.dumps({'error': '邮箱同步失败，请检查邮箱配置或授权信息'}, ensure_ascii=False)); sys.exit(2)
