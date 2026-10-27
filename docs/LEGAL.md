# Legal questions to take to counsel before launch

Halqo is end-to-end encrypted: the operator cannot read posts, photos, replies, profiles or messages, and holds no
names, emails or phone numbers. These are the questions a lawyer in each launch country should answer. Nothing here
is legal advice.

## Platform liability and moderation
- Hosting/intermediary liability for user content the operator cannot see (e.g. EU DSA, UK Online Safety Act, US
  Section 230): which duties apply to a private, invite-only, end-to-end encrypted service of this size?
- **There is no in-app reporting to the operator** (owner decision: posts go only to people who know each other,
  who can ask each other to remove things; users can block and mute). Do notice-and-action duties require a way to
  report content to the operator? A contact address for complaints may be the minimum.
- **App stores:** Apple's App Review Guideline 1.2 (user-generated content) asks for a way to report offensive
  content and to block abusive users, and timely responses; Google Play has a similar user-generated content
  policy. Expect review to ask about reporting; decide before submitting.
- Child safety: obligations to detect or report CSAM on an E2EE service (e.g. US 18 U.S.C. § 2258A once the
  operator has actual knowledge; EU and UK proposals on client-side scanning). Halqo does no scanning and has no
  reporting channel; confirm this is lawful where you launch.
- Terms of service and community guidelines; age limits (13/16) and age assurance.

## Lawful access and data requests
- What the operator can hand over when compelled: account existence, devices, friendship graph, timestamps, padded
  sizes and IP addresses seen by the hosting provider (the app server does not log IPs). Content and keys cannot be
  provided because the operator does not have them.
- Whether any jurisdiction can compel the operator to change the app (e.g. UK Investigatory Powers Act technical
  capability notices, Australia's Assistance and Access Act) and what a warrant canary or transparency report should
  say.
- Data retention rules: messages are deleted from the server after 30 days; deleted accounts leave no rows or objects.

## Privacy law
- GDPR/UK GDPR: roles (controller), lawful basis, records of processing, DPIA for an E2EE social network, data
  subject rights (export and deletion are built in), international transfers for the hosting and push providers
  (Apple/Google receive only "new activity" pushes and device tokens).
- Export controls on encryption (e.g. US EAR mass-market notification, Apple's export compliance answers).

## Before launch, also
- External cryptography audit of /core and the protocols in docs/CRYPTO.md.
- Penetration test of the server and app.
