# Legal questions to take to counsel before launch

Circlo is a private, invite-only, circles-based social network. Since 2026-11-01 it is **not** end-to-end encrypted:
posts, photos, replies, profiles and messages travel over HTTPS and are stored by the operator, who enforces who can
see them. Accounts have a name, username, email and password. These are the questions a lawyer in each launch country
should answer. Nothing here is legal advice.

## Platform liability and moderation
- Hosting/intermediary liability for user content the operator stores and can read (e.g. EU DSA, UK Online Safety
  Act, US Section 230): which duties apply to a private, invite-only service of this size, now that content can be
  reviewed?
- **In-app reporting to the operator** (posts reinstated 2026-10-29; people and chat messages added the same day):
  a report names the post, person or chat message and a reason; the server keeps a copy of what was reported (so
  deleting it doesn't erase it), and moderators can also look at the reported content in place. Confirm this meets
  notice-and-action duties, and set response times, retention for reports, and what happens to reported accounts.
- **App stores:** Apple's App Review Guideline 1.2 (user-generated content) asks for a way to report offensive
  content and to block abusive users, and timely responses; Google Play has a similar user-generated content
  policy. Posts, people and chat messages can be reported, and anyone can be blocked (from a post, a profile, a chat
  message, or right after reporting). Signup requires agreeing to the Terms of Use and Privacy Policy, with a
  no-tolerance line for abusive content. The app links to Terms, Privacy, Child safety standards and Support on
  www.hellocirclo.com (`app/src/lib/links.ts`); those pages, plus `/delete-account` (Google Play's web deletion
  request), must be live before store submission.
- Child safety: obligations to detect or report CSAM (e.g. US 18 U.S.C. § 2258A once the
  operator has actual knowledge; EU and UK proposals on client-side scanning). Circlo does no scanning; reports (including
  "puts a child at risk") reach the operator, who then has actual knowledge. Define the escalation process (e.g. to
  NCMEC) before launch, and confirm this is lawful where you launch.
- Terms of service and community guidelines (to publish at www.hellocirclo.com/terms); age limits (13/16) and age
  assurance. Google Play's child safety standards policy needs a published standards page (/child-safety) and a
  named child-safety contact.

## Lawful access and data requests
- What the operator can hand over when compelled: account details (name, username, email), friendships, circles,
  posts, replies, photos, messages and timestamps; IP addresses are seen only by the hosting provider (the app server
  does not log them). Set a policy for responding to requests and for telling users.
- Whether any jurisdiction can compel the operator to change the app (e.g. UK Investigatory Powers Act technical
  capability notices, Australia's Assistance and Access Act) and what a warrant canary or transparency report should
  say.
- Data retention rules: content is kept until the person deletes it or their account; unverified signups are
  deleted after a day; deleted accounts leave no rows or objects (reports keep a copy of the reported content).

## Privacy law
- GDPR/UK GDPR: roles (controller), lawful basis, records of processing, DPIA for a social network holding private content and emails, data
  subject rights (export and deletion are built in), international transfers for the hosting provider. There is no
  push provider: notifications are local, from background checks against the Circlo server.
- Export controls: the apps use only the operating system's standard HTTPS, which Apple treats as exempt.

## Before launch, also
- A penetration test of the server, the apps and the web app (access checks, account takeover, uploads).
- Penetration test of the server and app.
