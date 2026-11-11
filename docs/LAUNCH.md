# Launch checklist

Where Circlo stands on 2026-11-11: 1.0 is on the App Store, 1.1 (chat, sign-in codes, fixes) is in App Store review,
and Google Play is in closed testing (12 testers, 14 days before production access can be requested). The web app
at app.hellocirclo.com already runs the 1.1 code, so it is the version to show people until the stores catch up.

Launch day is the day **both** stores have 1.1. Before that, grow quietly through the web app and invite links; don't
post publicly, because people who can't find the app in their phone's store don't come back.

## Now, while the stores review

**The product**

- [ ] The web app is on the latest `main`: Messages tab present, sign-in asks for an emailed code.
- [ ] Walk through the whole thing on a real iPhone, a real Android phone, a phone browser and a desktop browser:
      sign up (the code arrives, and not in spam), log in with the code, forgot password, add a photo, invite by
      link and by QR, add someone to a circle, post to that circle and check a friend outside it can't see it,
      reply, reply to a reply, chat one-to-one and in a group with a photo, report, block, export my data, delete a
      throwaway account.
- [ ] Open an invite link (`https://app.hellocirclo.com/i/<token>`) on a phone with Circlo installed (opens the app)
      and without it (opens the web app).
- [ ] Production email: a real provider, with SPF, DKIM and DMARC on the sending domain. Send a code to Gmail,
      Outlook and iCloud addresses and check each lands in the inbox.
- [ ] Encryption at rest for the database, its backups and the media bucket (HARDENING.md, "Data at rest").
- [ ] Backups: restore last night's database backup somewhere else once, to know it works.

**Real people on it**

- [ ] 3 to 5 real groups (family, close friends, school parents) using it every week, each in its own circle.
- [ ] Keep a feedback note: what confused people, what they asked for, what broke. Fix the confusing parts first.
- [ ] Google testers: ask them to open the app and post or reply a couple of times a week. Google looks at whether
      testers used the app, not only whether they installed it.
- [ ] Note what the testers said and what changed because of it: the production access form asks for both.

**Launch material**

- [ ] Short screen recordings (15 to 30 seconds, from the demo accounts, never real people): posting to Family only
      and a friend outside it not seeing it; a chat; inviting with the QR code; changing who can see a post.
- [ ] One launch post telling the story ("the anti-social network": your people, in circles, no ads following you,
      no likes to chase). Versions for Product Hunt, Reddit (parenting, privacy and family communities, following
      each one's self-promotion rules), and your own accounts.
- [ ] A short email to everyone you know, with your invite link.
- [ ] Website: the home page and FAQ match 1.1 (chat is back, sign-in codes).
- [ ] App Store 1.1 listing: the description and "What's New" mention chat; screenshots include a chat.
- [ ] Google Play listing finished and saved: description, screenshots, feature graphic, content rating, data safety
      form (email, name, user content; no tracking).

## When Apple approves 1.1

- [ ] Release it (if it was held for manual release) and check the App Store page shows 1.1.
- [ ] Turn on the web app's "Get Circlo for iPhone" banner: `APP_BANNER_ENABLED = true` in
      `app/src/lib/features.ts` (and its test), then deploy the web app.
- [ ] Install from the App Store on an iPhone that never had Circlo, and sign up from scratch.

## When Google grants production access

- [ ] Promote the tested build to production (a staged rollout, starting at 20%, is safer).
- [ ] Set `playStore` in the website's `src/site.ts` so its Google Play button links to the listing.
- [ ] Install from Google Play on a phone that never had Circlo, and sign up from scratch.

## Launch day (both stores have 1.1)

- [ ] Post the launch material, then stay around to answer comments the same day.
- [ ] Watch the server: error rate, response times, disk and bucket space, email sending.
- [ ] Answer every support email within a day.

## The first two weeks after

- [ ] Read every review in both stores and reply to the ones with a question or a problem.
- [ ] Fix what new people trip over, in a 1.1.x release.
- [ ] Decide on v1.2 (paid storage plans) once people are using it, not before.
