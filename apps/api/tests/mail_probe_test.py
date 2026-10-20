import contextlib
import importlib.util
import io
import json
from pathlib import Path
import runpy
import smtplib
import ssl
import unittest
from unittest.mock import MagicMock, patch

PROBE = Path(__file__).resolve().parents[1] / 'src/modules/mail/probe.py'
spec = importlib.util.spec_from_file_location('mail_probe', PROBE)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class MailProbeTest(unittest.TestCase):
    def setUp(self):
        self.request = {'provider': {'imapHost': 'imap.example.test', 'smtpHost': 'smtp.example.test'}, 'email': 'synthetic@example.test', 'secret': 'synthetic-secret', 'verifySmtp': True}
        self.client = MagicMock()
        self.client.select.return_value = ('OK', [])
        self.client.uid.return_value = ('OK', [b''])
        self.imap = patch.object(probe.imaplib, 'IMAP4_SSL', return_value=self.client).start()
        self.smtp = patch.object(probe.smtplib, 'SMTP_SSL').start()
        self.addCleanup(patch.stopall)

    def failure_code(self):
        try:
            probe.run(self.request)
        except Exception as caught:
            return probe.error_payload(caught)['code']
        self.fail('Expected the mailbox operation to fail')

    def test_wrong_imap_credential_is_authentication_failure(self):
        self.client.login.side_effect = probe.imaplib.IMAP4.error('[AUTHENTICATIONFAILED] Invalid credentials synthetic-secret')
        self.assertEqual(self.failure_code(), 'IMAP_AUTH_FAILED')
        self.client.select.assert_not_called()
        self.client.logout.assert_called_once()
        self.smtp.assert_not_called()

    def test_wrong_smtp_credential_is_authentication_failure(self):
        self.smtp.return_value.login.side_effect = smtplib.SMTPAuthenticationError(535, b'Authentication failed')
        self.assertEqual(self.failure_code(), 'IMAP_AUTH_FAILED')
        self.smtp.return_value.quit.assert_called_once()

    def test_provider_restrictions_are_not_wrong_credentials(self):
        for message, expected in [('IMAP service is disabled', 'IMAP_NOT_ENABLED'), ('Unsafe Login', 'IMAP_ACCESS_DENIED'), ('Too many login attempts', 'IMAP_RATE_LIMITED')]:
            with self.subTest(message=message):
                self.client.login.side_effect = probe.imaplib.IMAP4.error(message)
                self.assertEqual(self.failure_code(), expected)

    def test_temporary_smtp_failure_is_not_wrong_credentials(self):
        self.smtp.return_value.login.side_effect = smtplib.SMTPAuthenticationError(454, b'Temporary authentication failure')
        self.assertEqual(self.failure_code(), 'IMAP_RATE_LIMITED')

    def test_network_tls_and_timeout_are_not_wrong_credentials(self):
        for caught, expected in [(TimeoutError('secret'), 'IMAP_TIMEOUT'), (ssl.SSLError('secret'), 'IMAP_TLS_FAILED'), (OSError('secret'), 'IMAP_CONNECTION_FAILED')]:
            with self.subTest(expected=expected):
                self.imap.side_effect = caught
                self.assertEqual(self.failure_code(), expected)

    def test_dropped_connection_during_login_is_not_wrong_credentials(self):
        self.client.login.side_effect = probe.imaplib.IMAP4.abort('Connection closed')
        self.assertEqual(self.failure_code(), 'IMAP_CONNECTION_FAILED')

    def test_failure_after_login_is_not_wrong_credentials(self):
        self.client.select.side_effect = probe.imaplib.IMAP4.error('Mailbox unavailable')
        self.assertEqual(self.failure_code(), 'IMAP_REQUEST_FAILED')

    def test_success_preserves_read_only_behavior(self):
        self.assertEqual(probe.run(self.request), {'messages': []})
        self.client.select.assert_called_once_with('INBOX', readonly=True)
        self.smtp.return_value.login.assert_called_once_with(self.request['email'], self.request['secret'])
        for context in [self.imap.call_args.kwargs['ssl_context'], self.smtp.call_args.kwargs['context']]:
            self.assertTrue(context.check_hostname)
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)

    def test_entry_point_emits_safe_structured_error_without_provider_details(self):
        self.client.login.side_effect = probe.imaplib.IMAP4.error('Invalid credentials synthetic-secret synthetic@example.test')
        output = io.StringIO()
        with patch('sys.stdin', io.StringIO(json.dumps(self.request))), contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit) as exited:
                runpy.run_path(str(PROBE), run_name='__main__')
        self.assertEqual(exited.exception.code, 2)
        payload = json.loads(output.getvalue())
        self.assertEqual(payload['code'], 'IMAP_AUTH_FAILED')
        self.assertNotIn('synthetic-secret', output.getvalue())
        self.assertNotIn('synthetic@example.test', output.getvalue())


if __name__ == '__main__':
    unittest.main()
