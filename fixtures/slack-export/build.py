import json, os, datetime as dt
U = {
 "U01MAYA": ("Maya Levi", "Head of Product"),
 "U02TOM": ("Tom Brenner", "Engineering Lead"),
 "U03NOA": ("Noa Katz", "Support Lead"),
 "U04ELI": ("Eli Shapiro", "Designer (part-time)"),
 "U05LIOR": ("Lior Ben-David", "Customer Success"),
 "U06BEN": ("Ben Cooper", "Sales"),
 "U07YAEL": ("Yael Stern", "Frontend Engineer"),
}
# (date, hour, channel, user, text, [replies (user, text)])
M = [
 # --- August ---
 ("2026-08-18",10,"product","U01MAYA","Q3 goal reminder: mean time to triage critical alerts on crown-jewel assets under 5 min. Today we're around 20. Everything we pick this quarter should move that number.",[("U02TOM","Agreed. Most of that time is analysts digging through the queue, not the investigation itself.")]),
 ("2026-08-19",14,"support","U03NOA","Northwind again: \"we opened 40 alerts to find the 3 that mattered\". Third time this month from them. Ticket NW-2291.",[("U05LIOR","Same from Helix on our QBR. Their SOC lead literally said the queue is 'a wall of grey'."),("U03NOA","Tagging as alert-noise.")]),
 ("2026-08-20",11,"design","U04ELI","Looking at the alert queue: severity is plain text in the same grey as everything else. We have --color-sev-* tokens in tokens.css that nobody uses. Proposal: severity always shows as a coloured badge + the word. Never colour alone (colour-blind analysts).",[("U07YAEL","Badge.tsx only has one neutral style right now, so this needs a severity variant."),("U04ELI","Yes, a variant, not a new component.")]),
 ("2026-08-22",9,"support","U03NOA","Acme asked whether we can sort the queue by severity. Told them it's newest-first for now. Ticket AC-118.",[]),
 ("2026-08-25",16,"support","U03NOA","Helix: \"is there a way to export an incident timeline as PDF for our auditors?\" Ticket HX-77.",[("U05LIOR","Acme asked for the same thing last month, for their SOC2 audit.")]),
 ("2026-08-26",15,"product","U01MAYA","Decision from today's design review: severity is always shown with the sev colour token AND the word, everywhere (queue, overview, incident). Eli's proposal. @Tom Brenner can we get it into the queue this quarter?",[("U02TOM","Yes, I'll put it on the Q3 list. Small change."),("U04ELI","I'll write it into design-system.md too.")]),
 ("2026-08-27",12,"design","U04ELI","PageHeader subtitle uses a hardcoded #b8bcc4. That's ~1.9:1 on our light background, fails AA badly. Should be --color-text-muted.",[("U07YAEL","Will fix when I'm in there. Not urgent?"),("U04ELI","It's on every screen. I'd call it urgent-ish.")]),
 ("2026-08-29",10,"product","U06BEN","Prospect (Fintech, 40 analysts) asked for a 'Reports' tab in the main nav with weekly stats. Could be a deal-maker.",[("U01MAYA","D-15: no new top-level nav this year. If we do weekly stats it goes into Overview."),("U06BEN","Understood, I'll position it as Overview.")]),
 # --- September ---
 ("2026-09-02",11,"support","U03NOA","Northwind ticket NW-2340: a credential dump on DC-01 sat in the queue for 20 min under PowerShell noise from a test box. Their CISO is now involved.",[("U02TOM","Ouch. The queue sorts only by time, so a burst of low-severity noise pushes everything down."),("U01MAYA","This is exactly the Q3 metric. Let's talk Thursday.")]),
 ("2026-09-04",15,"product","U01MAYA","Thursday sync notes: (1) Queue ordering: options are sort by severity+asset criticality, or collapse duplicates by fingerprint. Leaning to sorting first. (2) Severity badges (decided 26/8) still not done. (3) PDF timeline export: 3 customers now, parking until Q4.",[("U02TOM","On (2): sorry, slipped behind the API work. Still planned.")]),
 ("2026-09-08",13,"support","U03NOA","Analysts keep asking why 'Isolate host' is greyed out. The tooltip explains it but nobody hovers. 4 tickets this week.",[("U01MAYA","That's D-12, only incident leads isolate. The rule stays. But the explanation could be visible, not a tooltip.")]),
 ("2026-09-10",10,"design","U07YAEL","Question for design: do we want a dark theme at some point? Two customers run their SOC in dark rooms and asked.",[("U04ELI","If we do, tokens first: every colour in components must come from tokens.css. Right now PageHeader and a few others hardcode hex, which would break dark mode."),("U07YAEL","OK so the hex cleanup is a prerequisite either way.")]),
 ("2026-09-12",16,"support","U05LIOR","Acme QBR feedback: 'we love the incident view, we hate the queue'. Direct quote from their SOC manager.",[]),
 ("2026-09-15",11,"support","U03NOA","Another PDF export request (Northwind) for incident timelines. That's 4 accounts.",[("U05LIOR","Adding to the request list.")]),
 ("2026-09-17",14,"product","U02TOM","FYI the API already returns asset, assetCriticality and fingerprint for every alert. So both queue options are frontend-only.",[("U01MAYA","Great, that makes it cheaper.")]),
 ("2026-09-22",10,"design","U04ELI","Badge with severity variant: drafted the spec. Variants: critical/high/medium/low using --color-sev-*, plus text. Critical rows on crown-jewel assets get --color-sev-critical-bg. Nobody has picked it up yet.",[]),
 ("2026-09-24",15,"support","U03NOA","Usability session notes from Lior: analyst scrolled ~46 rows before finding the first critical. She said 'I just open everything, it's faster than reading'.",[]),
 ("2026-09-29",12,"product","U06BEN","Acme pilot expansion is blocked on the queue. Their words: 'fix the noise and we sign for 3 more teams'.",[("U01MAYA","Noted. This is now the top priority for October.")]),
 # --- October ---
 ("2026-10-01",11,"product","U01MAYA","For the Acme expansion: let's hide duplicate alerts by default in the queue (show only the latest of each fingerprint), with a toggle to show all. They want the noise gone.",[("U02TOM","Doesn't that clash with the 'every raw alert stays visible' rule?"),("U01MAYA","It's a toggle, they can still see everything. Let's do it for Acme."),("U03NOA","Careful, Northwind's auditors specifically check that nothing is hidden by default.")]),
 ("2026-10-03",9,"support","U03NOA","Helix ticket HX-102: same 'can't find the critical alerts' complaint. Attaching their screenshot of a queue page with 12 low-severity PowerShell alerts on top.",[]),
 ("2026-10-06",14,"design","U04ELI","Reminder that the severity decision from 26/8 is still not in the product. Queue still shows grey text severity. It's been 6 weeks.",[("U07YAEL","It's on me now, Tom moved it. This sprint.")]),
 ("2026-10-08",10,"design","U04ELI","Proposal: --color-text-muted is #5b6270. For dark mode later we'd need a pair. Can we agree now that all text colours go through 3 tokens (default, muted, inverse)?",[("U07YAEL","Fine by me."),("U01MAYA","Agreed, as long as it doesn't delay the queue work.")]),
 ("2026-10-13",16,"support","U03NOA","Weekly roundup: alert-noise tickets 7 (Northwind 3, Acme 2, Helix 2). Isolate-button confusion 3. PDF export 1.",[]),
 ("2026-10-15",11,"product","U01MAYA","Q3 retro: MTTT for criticals still ~21 min. We didn't ship the queue changes. October is the month.",[("U02TOM","Agreed. Queue + severity badges together."),("U04ELI","And please don't hide duplicates by default until we've settled the D-07 question.")]),
]
users = [{"id": k, "name": v[0].split()[0].lower(), "real_name": v[0], "profile": {"title": v[1]}} for k, v in U.items()]
json.dump(users, open("users.json", "w"), indent=1)
chans = sorted({m[2] for m in M})
json.dump([{"name": c, "id": f"C_{c.upper()}"} for c in chans], open("channels.json", "w"), indent=1)
byfile = {}
for i, (date, hour, ch, user, text, replies) in enumerate(M):
    t = dt.datetime.fromisoformat(f"{date}T{hour:02d}:00:00+00:00").timestamp() + i
    ts = f"{t:.6f}"
    msgs = [{"type": "message", "user": user, "text": text, "ts": ts, **({"thread_ts": ts, "reply_count": len(replies)} if replies else {})}]
    for j, (ru, rt) in enumerate(replies):
        msgs.append({"type": "message", "user": ru, "text": rt, "ts": f"{t + 600 * (j + 1):.6f}", "thread_ts": ts})
    byfile.setdefault((ch, date), []).extend(msgs)
for (ch, date), msgs in byfile.items():
    os.makedirs(ch, exist_ok=True)
    json.dump(msgs, open(f"{ch}/{date}.json", "w"), indent=1)
print(len(M), "top-level messages,", sum(len(m[5]) for m in M), "replies,", len(byfile), "day files")
