> **DRAFT: NOT YET IN EFFECT.** Prepared 2026-09-30
> This draft was prepared from the product requirements ([PRD.md](../../PRD.md) v0.5, plus offline friends from v0.9, D44). **It is not legal advice.** A Jamaican data-protection lawyer must review it before publication (ISSUES WF-119).
> The site renders everything from the `# Privacy Policy` title down at `/privacy`; this note isn't shown. Values in `[CAPITALS]` (the entity, emails, domain, effective date, retention periods) and the version are filled in **one place**, `apps/web/src/lib/legal.ts`; don't type them here. `[COUNSEL: …]` and `[VERIFY: …]` notes are resolved in this text during the legal review.

# Privacy Policy

**Effective date:** [EFFECTIVE DATE]
**Version:** [VERSION]

synkd ("**synkd**", "**we**", "**us**") helps you and the people you choose see when each other are free. To do that, we handle information about your schedule. This policy explains, in plain language, what we collect, why, who can see it, how long we keep it, and the rights you have.

**The short version**
- We show your availability, **not your location**. We never store where your classes, shifts or events take place.
- By default, people you connect with see only **"Free" or "Busy" and until when**. You decide who sees more.
- Uploaded timetables and rosters are **deleted as soon as you confirm your schedule**.
- If you add a friend who isn't on synkd, you need **their permission**, we keep only a nickname and their schedule, and **only you** can see it.
- We **never sell** your data, and we don't use it for advertising.
- You must be **18 or older** to use synkd.

---

## 1. Who we are

synkd ([DOMAIN]) is operated by **[LEGAL ENTITY NAME]**, [REGISTERED ADDRESS], Jamaica ("we"). For the Data Protection Act, 2020 of Jamaica, we are the **data controller** of the personal data described in this policy.

- **Privacy contact:** [PRIVACY EMAIL]
- **Data Protection Officer:** [DATA PROTECTION OFFICER]

---

## 2. What we collect

### 2.1 Information you give us
| What | Examples | Why we need it |
|---|---|---|
| **Account details** | Name, email address, profile photo (from your Google account if you sign in with Google, which you can replace), an optional handle like `@kemar` | To create your account and show you to people you connect with |
| **Age confirmation** | Your date of birth, entered at sign-up | To confirm you're 18 or over. **We keep only your birth year** and the date you confirmed. We don't store your full date of birth. |
| **Your schedule** | Event titles (e.g. "COMP2140 Lecture", "Shift"), the type of event (class, work, meeting…), days and times, how often they repeat, and the dates your schedule covers | To work out when you're free or busy |
| **Uploaded files** | A PDF, screenshot or photo of your timetable or roster | To read your schedule automatically. **Deleted when you confirm it** (see §6). |
| **Available hours** | The times of day you're usually up and about (e.g. 8 AM–10 PM) | So you don't show as "free" while you're asleep |
| **Statuses** | "Do not disturb until 4 PM", "Away" | To override your calendar when you choose |
| **Connections** | Your friends, the groups you're in, your role and permissions in each group, and the visibility level you picked for each | To decide who can see your availability, and how much of it |
| **Pings and replies** | Templates like "Free for food?", short messages you write (up to 140 characters), and replies | To deliver them to the person you're pinging |
| **Reports** | A report you make about another user, group or ping | To keep synkd safe |
| **Feedback** | A message you send us with "Send feedback" or "Report this problem", the page you sent it from, your browser type (e.g. "Safari on iPhone"), whether you use the installed app, and whether we may email you about it | To fix bugs and decide what to improve. Only our team can read it. We email you about it only if you said we could. |

### 2.2 Information from Google Calendar (only if you connect it)
If you choose to connect Google Calendar, we read events from the calendars you select. From each event we store **only**:
- the **start and end time**,
- whether it counts as **busy**,
- whether you've marked it **private**, and
- Google's internal event ID, so we can keep it up to date.

We store an event's **title only if you've given at least one friend or group the "Details" level**. If you remove that level from everyone, we delete stored Google titles within 24 hours.

We **never store** event descriptions, attendees, locations, video-call links or attachments.

We also store an encrypted access token so we can keep your calendar in sync. You can disconnect at any time (§8).

### 2.3 Information collected automatically
| What | Why |
|---|---|
| **Device and browser information** (browser type, operating system, app version) | To make the app work on your device and to fix bugs |
| **Push notification subscription** (a technical address your browser gives us) | To send you notifications you've allowed |
| **Usage events** (e.g. "uploaded a schedule", "sent a ping") | To understand which features work and to improve the app. These **never include** your event titles, ping text or schedule contents. |
| **Error reports** | To find and fix crashes |

We've configured our analytics and error-reporting tools **not to store your IP address**.

### 2.4 Friends who aren't on synkd ("offline friends")
You can add a friend who isn't on synkd yet, so you can see when they're free before they join. If you do, we store **only**:
- a **nickname** you choose for them (and an optional emoji), not their real name;
- **their schedule**, from a timetable or roster you upload for them or enter yourself: the same kind of details as your own schedule in §2.1 (event titles, types, days and times, and how often they repeat); and
- the **date and time you confirmed** that you have their permission.

We **never** store their contact details, photo or account details, or where their events take place. A file you upload for them is handled exactly like your own: it's read by the same automated tools (§5) and **deleted as soon as you confirm the schedule**, or 7 days after upload if you never confirm it.

**Only you can see an offline friend.** Their nickname and schedule are never shown to anyone else, at any level, never searchable, and never matched or merged with a synkd account, even if that person joins later. Their schedule never changes your own availability or what other people see of you.

**Legal basis.** Before you can add an offline friend, you must confirm that **you have that person's permission** to add their schedule, and we record when you confirmed it. We hold their information on the basis of that permission, which you obtain and confirm to us. [COUNSEL: confirm the lawful basis for holding the schedules of people who aren't users (NFR-COMP-9), and whether they must be told.]

**Deleting it.** You can edit, re-upload or delete an offline friend at any time, and deleting one removes their schedule **straight away**. Their past events are deleted after 90 days, like yours. If you delete your account, your offline friends are deleted with it. If they join synkd and become your friend, we'll offer to delete the offline copy.

**If someone added your schedule.** If you think someone added your schedule without your permission, ask them to delete it, or contact us at [PRIVACY EMAIL]. Because we hold only a nickname, we may ask for details that help us find the entry (such as who added you), and we'll use them only to handle your request.

### 2.5 What we do *not* collect
- **Location.** We don't track where you are, and we don't store where your events take place. If your uploaded file shows rooms or addresses, we ignore them.
- **ID numbers and other document details.** If your timetable shows a student or employee ID number, a photo or a programme code, our system is designed to ignore it and not save it. The file itself is deleted when you confirm your schedule. *Tip: you can crop those details out before uploading.*
- **Your full date of birth.**
- **Your contacts or address book.**

---

## 3. How we use your information

We use your information only to:
1. **Provide synkd**: work out your availability, show it to the people you've chosen at the level you've chosen, deliver pings, find times when a group is free, and show you when offline friends you've added are free (§2.4).
2. **Read your uploaded schedule** using automated tools, including AI (§5).
3. **Keep synkd safe**: rate limits, blocking, reports, and investigating misuse.
4. **Improve synkd**: using usage events and error reports that don't include your schedule contents.
5. **Communicate with you** about your account, and about changes to these policies.
6. **Meet legal obligations.**

We do **not** sell your personal data, use it for advertising, or use it to build advertising profiles.

**Legal basis.** We process your personal data on the basis of **your consent**, given at sign-up and when you connect Google Calendar, and because it is **necessary to provide the service you asked for**. You can withdraw your consent at any time by disconnecting a source or deleting your account (§8). [COUNSEL: confirm the conditions for processing under the Data Protection Act, 2020 and adjust this wording.]

**Sensitive information.** We don't ask for sensitive personal data such as health, religious or political information. However, event titles you enter or sync could reveal it (e.g. "Clinic", "Church"). You control this: keep titles hidden (the default), mark events private, or rename them. [COUNSEL: confirm treatment of incidental sensitive personal data.]

---

## 4. Who can see your information

### 4.1 Other synkd users: you're in control
When you connect with a friend or join a group, **you choose what they see** before the connection is made:

| Level | What they see | Example |
|---|---|---|
| **Free/Busy** (default) | Whether you're free or busy, and until when | "Busy until 3:00 PM" |
| **Category** | The above, plus the type of event | "In class until 3:00 PM" |
| **Details** | The above, plus the event title | "COMP2140 Lecture until 3:00 PM" |

- If someone is in more than one of your groups, they see the **most restrictive** level, unless you've set a level for them personally.
- Group admins **don't** get extra access to your schedule.
- You can change levels, mark events private, pause sharing, remove friends, leave groups or block people at any time.
- **Nobody** ever sees your location, because we don't have it.
- Offline friends you add (§2.4) are visible **only to you**.
- People with the invite link to a group can see the group's name, its emoji, how many members it has, and who invited them.

### 4.2 Service providers
We use trusted companies to run synkd. They process data **on our behalf and only for the purposes below**:

| Provider | What they do | Data involved |
|---|---|---|
| **Clerk** | Sign-in and account security, including storing your password securely if you sign in with email (we never see it) | Name, email, profile photo, password (hashed), sign-in records |
| **Supabase** | Database and temporary file storage | Everything in §2 |
| **Vercel** | Hosting the website and app | Technical request data |
| **Railway** | Processing uploaded files | Uploaded files, briefly, while they're being read |
| **OpenRouter** and the AI model providers it connects to | Reading your uploaded schedule (§5) | Uploaded files and the resulting schedule draft |
| **Google** | Sign-in, and Google Calendar if you connect it | As described in §2.2 |
| **PostHog** | Product analytics | Usage events and device info. No IP addresses and no schedule contents. |
| **Sentry** | Error reporting | Error details and device info. No IP addresses. |
| **Browser push services** (e.g. Google, Apple, Mozilla) | Delivering notifications to your device | Encrypted notification content |

We may also disclose information if **required by law**, or to protect the safety of any person.

### 4.3 International transfers
Most of these providers store or process data **outside Jamaica**, mainly in the **United States**. [COUNSEL: describe the safeguards or legal basis relied on for cross-border transfers under the Data Protection Act, 2020.]

---

## 5. How we read your uploaded schedule (AI processing)

When you upload a timetable or roster (yours, or an offline friend's), we send the file to an AI model through **OpenRouter** to pull out your events. Then:
- You **always review and confirm** the result before anything is saved. Nothing is added to your schedule automatically.
- We've configured OpenRouter to use only providers that **don't retain or train on** what we send. [VERIFY: confirm OpenRouter's current data-retention and training guarantees before publication.]
- **Google Calendar data is never sent to any AI model.**
- The AI only reads your schedule. It isn't used to make decisions about you.

---

## 6. How long we keep your information

| Information | How long |
|---|---|
| **Uploaded files** | **Deleted as soon as you confirm your schedule.** Files you never confirm are deleted **7 days** after upload. |
| **Schedule events** | While your account is active. **Past events are deleted after 90 days.** |
| **Offline friends** (nickname, schedule and permission date) | Until you delete them or your account. Deleting one removes their schedule straight away. Their uploaded files and past events follow the same rules as yours. |
| **Google Calendar data** | While connected. Titles are kept only while someone has the "Details" level. **Everything is deleted within 24 hours of disconnecting.** |
| **Pings and replies** | **30 days** |
| **Account details, connections, preferences** | Until you delete your account |
| **Birth year and age confirmation** | Until you delete your account |
| **Consent records** | [CONSENT RECORD RETENTION] |
| **Reports** | [REPORT RETENTION] |
| **Feedback** | Until you delete your account |
| **Analytics and error reports** | [ANALYTICS RETENTION] |
| **Backups** | [BACKUP RETENTION] |

When you **delete your account**, you're removed from all groups straight away, and all your data, including any offline friends you added, is permanently deleted within **30 days**.

---

## 7. How we protect your information

- Encryption in transit (HTTPS) and at rest.
- Google Calendar access tokens are **encrypted separately** and never sent to your device.
- Uploaded files are stored privately, accessible only to you and our processing service, and deleted on confirmation.
- Other users only ever receive the information allowed by the level you chose. **This is enforced on our servers, not just in the app.**
- Our logs never contain your event titles, ping messages, file contents or access tokens.
- If a data breach affects your personal data, we'll notify the Information Commissioner and, where required, you, in line with the law. [COUNSEL: confirm the notification timeframe.]

No system is perfectly secure, but we design synkd to hold as little about you as possible.

---

## 8. Your rights and choices

Under the Data Protection Act, 2020, you have rights over your personal data, including the right to:
- **Access** a copy of the personal data we hold about you
- **Correct** inaccurate data
- **Delete** your data
- **Object to** or **prevent** certain processing
- **Withdraw consent** at any time
- **Complain** to the Information Commissioner

[COUNSEL: confirm the full list of data-subject rights and how each applies.]

**How to use them**
| You want to… | How |
|---|---|
| Change who sees what | Settings → **Who can see me** |
| Stop sharing temporarily | Settings → **Pause sharing** |
| Remove Google Calendar | Settings → **Google Calendar → Disconnect** (data deleted within 24 hours) |
| Delete a pending upload | **Pending uploads → Delete** |
| Get a copy of your data | Email [PRIVACY EMAIL] from your account's email address. We'll respond within 30 days. *(A self-serve export is coming.)* |
| Delete your account | Email [PRIVACY EMAIL] from your account's email address, or use Settings → **Delete account** once it's available. |

To protect your account, we'll only act on requests sent from the email address linked to it.

**Complaints.** Please contact us first at [PRIVACY EMAIL]. You can also complain to the **Office of the Information Commissioner (Jamaica)**: [OIC CONTACT DETAILS].

---

## 9. Google API Services: Limited Use disclosure

synkd's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

In particular, information from your Google Calendar is:
- used **only** to show your availability, at the levels you choose, to the people you choose;
- **never** used for advertising, **never** sold, and **never** sent to AI models;
- **never** read by humans, except with your permission, for security purposes, to comply with the law, or where it has been aggregated and anonymised for internal operations.

---

## 10. Age requirement

synkd is **only for people aged 18 and over**. We don't knowingly collect data from anyone under 18. If we learn an account belongs to someone under 18, we'll suspend it and delete its data. If you believe this has happened, contact [PRIVACY EMAIL].

---

## 11. Cookies and local storage

We use cookies and similar browser storage to:
- **keep you signed in** (required),
- **remember your settings** and store the latest version of your Now screen so it works offline (required), and
- **measure how the app is used** (analytics, without IP addresses).

[COUNSEL / PRODUCT: decide whether analytics requires opt-in consent, and add controls if so.]

---

## 12. Changes to this policy

If we make important changes, we'll tell you in the app and ask you to review the new version before you continue. The version number and effective date at the top will always show which version applies.

---

## 13. Contact us

**[LEGAL ENTITY NAME]**
[REGISTERED ADDRESS]
Email: [PRIVACY EMAIL]
