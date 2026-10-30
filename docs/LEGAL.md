# Legal questions to take to counsel before launch

Circlo is end-to-end encrypted: the operator cannot read posts, photos, replies, profiles or messages, and holds no
names, emails or phone numbers. These are the questions a lawyer in each launch country should answer. Nothing here
is legal advice.

## Platform liability and moderation
- Hosting/intermediary liability for user content the operator cannot see (e.g. EU DSA, UK Online Safety Act, US
  Section 230): which duties apply to a private, invite-only, end-to-end encrypted service of this size?
- **In-app reporting to the operator** (posts reinstated 2026-10-29; people and chat messages added the same day):
  the reporter's device seals what they see (a post's text and photos, a person's name, handle and bio, or one chat
  message with its sender) with a reason to the operator's moderation key; the operator reads it offline. Confirm
  this meets notice-and-action duties, and set response times, retention for reports, and what happens to reported
  accounts.
- **App stores:** Apple's App Review Guideline 1.2 (user-generated content) asks for a way to report offensive
  content and to block abusive users, and timely responses; Google Play has a similar user-generated content
  policy. Posts, people and chat messages can be reported, and anyone can be blocked (from a post, a profile, a chat
  message, or right after reporting). Signup requires agreeing to the Terms of Use and Privacy Policy, with a
  no-tolerance line for abusive content. The app links to Terms, Privacy, Child safety standards and Support on
  www.hellocirclo.com (`app/src/lib/links.ts`); those pages, plus `/delete-account` (Google Play's web deletion
  request), must be live before store submission.
- Child safety: obligations to detect or report CSAM on an E2EE service (e.g. US 18 U.S.C. § 2258A once the
  operator has actual knowledge; EU and UK proposals on client-side scanning). Circlo does no scanning; reports (including
  "puts a child at risk") reach the operator, who then has actual knowledge. Define the escalation process (e.g. to
  NCMEC) before launch, and confirm this is lawful where you launch.
- Terms of service and community guidelines (to publish at www.hellocirclo.com/terms); age limits (13/16) and age
  assurance. Google Play's child safety standards policy needs a published standards page (/child-safety) and a
  named child-safety contact.

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
  subject rights (export and deletion are built in), international transfers for the hosting provider. There is no
  push provider: notifications are local, from background checks against the Circlo server.
- Export controls on encryption (e.g. US EAR mass-market notification, Apple's export compliance answers).

## Before launch, also
- External cryptography audit of /core and the protocols in docs/CRYPTO.md.
- Penetration test of the server and app.
