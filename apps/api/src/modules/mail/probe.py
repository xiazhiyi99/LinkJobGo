#!/usr/bin/env python3
"""Small stdlib-only IMAP reader. Credentials are accepted only on stdin."""
import email, email.header, email.utils, html, imaplib, json, re, smtplib, ssl, sys
from datetime import date, datetime, timedelta, timezone

class MailProbeError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code

def authentication_error(caught):
    # Inspect provider text only locally; never include it in stdout or logs.
    response = str(caught).lower()
    if re.search(r'too many|rate.?limit|frequency|try again later|temporar|频繁|次数过多', response) or getattr(caught, 'smtp_code', None) in (421, 454):
        return MailProbeError('IMAP_RATE_LIMITED')
    if re.search(r'not enabled|disabled|not open|未开启|未开通|没有开启|请开启', response):
        return MailProbeError('IMAP_NOT_ENABLED')
    if re.search(r'unsafe|risk|suspicious|blocked|locked|suspended|security|access denied|not permitted|not allowed|安全|风控|限制登录|禁止登录', response):
        return MailProbeError('IMAP_ACCESS_DENIED')
    return MailProbeError('IMAP_AUTH_FAILED')

def error_payload(caught):
    if isinstance(caught, MailProbeError): code = caught.code
    elif isinstance(caught, TimeoutError): code = 'IMAP_TIMEOUT'
    elif isinstance(caught, ssl.SSLError): code = 'IMAP_TLS_FAILED'
    elif isinstance(caught, (OSError, imaplib.IMAP4.abort, smtplib.SMTPServerDisconnected)): code = 'IMAP_CONNECTION_FAILED'
    elif isinstance(caught, imaplib.IMAP4.error): code = 'IMAP_REQUEST_FAILED'
    else: code = 'IMAP_CONNECTION_FAILED'
    return {'error': '邮箱连接失败', 'code': code}

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
    client = imaplib.IMAP4_SSL(host, port, ssl_context=ssl.create_default_context(), timeout=20); messages = []
    try:
        try: client.login(request['email'], request['secret'])
        except imaplib.IMAP4.abort: raise
        except imaplib.IMAP4.error as caught: raise authentication_error(caught) from None
        status, _ = client.select('INBOX', readonly=True)
        if status != 'OK': raise MailProbeError('IMAP_REQUEST_FAILED')
        status, data = client.uid('search', None, 'SINCE', start.strftime('%d-%b-%Y'), 'BEFORE', (end + timedelta(days=1)).strftime('%d-%b-%Y'))
        if status != 'OK': raise MailProbeError('IMAP_REQUEST_FAILED')
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
            smtp = smtplib.SMTP_SSL(smtp_host, smtp_port, context=ssl.create_default_context(), timeout=20) if smtp_port == 465 else smtplib.SMTP(smtp_host, smtp_port, timeout=20)
            if smtp_port != 465: smtp.starttls(context=ssl.create_default_context())
            try: smtp.login(request['email'], request['secret'])
            except smtplib.SMTPAuthenticationError as caught: raise authentication_error(caught) from None
        finally:
            if smtp is not None:
                try: smtp.quit()
                except Exception: pass
    return {'messages': messages}

if __name__ == '__main__':
    try:
        print(json.dumps(run(json.load(sys.stdin)), ensure_ascii=False))
    except Exception as caught:
        print(json.dumps(error_payload(caught), ensure_ascii=False)); sys.exit(2)
