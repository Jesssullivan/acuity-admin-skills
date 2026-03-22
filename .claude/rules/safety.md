## Acuity Automation Safety Rules

1. **Never modify without explicit --execute flag.** All commands are dry-run by default.
2. **Always verify panel ID** before AND after entering edit mode. The Acuity SPA can swap panels.
3. **Circuit breaker**: Abort after 3 consecutive failures (configurable via --max-failures).
4. **SAFETY abort**: Immediately stop if verifyPanelId detects wrong appointment.
5. **Screenshot on failure**: Capture full-page screenshot for debugging.
6. **No credential storage in code**: Auth resolved from env vars or cookie files only.
7. **Cookie files are secrets**: Never commit. `.gitignore` patterns enforced.
8. **Screenshots contain PII**: Clean up `/tmp/acuity-admin-screenshots/` after debugging.
9. **The $ prefix on calendar entries is NOT a reliable paid indicator.** Always check detail panel.
10. **Close detail panel after every operation** to prevent stale panel bugs.
11. **No Acuity sandbox exists.** All operations hit production. Test with read-only operations first.
