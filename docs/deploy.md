# העלאת ג'וני לשרת קבוע (Railway)

ג'וני מתחבר לסלאק ב-Socket Mode, ולכן לא צריך כתובת ציבורית, דומיין או SSL. מספיק שרת אחד שרץ כל הזמן.

## לפני שמתחילים: מפתחות חדשים

המפתחות הנוכחיים נחשפו בצילומי מסך. מחליפים אותם עכשיו, ומזינים בשרת רק את החדשים.

- **Anthropic:** ב-Console, תחת API Keys, יוצרים מפתח חדש ומבטלים את הישן. מוודאים שיש קרדיט בחשבון, תחת Plans & Billing.
- **Slack bot token:** ב-api.slack.com/apps, בוחרים Johnny ואז OAuth & Permissions, ומבטלים את הטוקן הנוכחי. בהתקנה מחדש נוצר טוקן חדש מסוג `xoxb-`.
- **Slack app token:** תחת Basic Information, ב-App-Level Tokens, יוצרים טוקן חדש עם `connections:write` ומוחקים את הישן.
- **GitHub:** ב-Settings, תחת Developer settings, יוצרים Fine-grained token עם גישה רק ל-`oricie/johnny-sandbox`, והרשאת Contents במצב Read and write.

## עדכון ה-manifest בסלאק

נוסף אירוע `member_joined_channel`, וככה ג'וני יודע שצירפו אותו לערוץ ומתחיל לקרוא את ההיסטוריה שלו.

1. ב-api.slack.com/apps בוחרים Johnny, ואז App Manifest.
2. מדביקים את התוכן של `slack/manifest.json`.
3. שומרים, ומתקינים מחדש (Reinstall).

## Railway

1. ב-railway.com יוצרים New Project, בוחרים Deploy from GitHub repo, ואז `oricie/johnny-sandbox`. Railway מזהה את `Dockerfile` ואת `railway.json` לבד.
2. תחת Variables מוסיפים:
   - `JOHNNY_ANTHROPIC_KEY`
   - `JOHNNY_SLACK_BOT_TOKEN`
   - `JOHNNY_SLACK_APP_TOKEN`
   - `GITHUB_TOKEN`
   - `JOHNNY_NETLIFY_TOKEN` (לא חובה, צריך אותו רק לקישורים חיים)
3. מוסיפים Volume עם mount path ‏`/data`. שם נשמרים הריפו, מה שג'וני למד וה-runs, והם שורדים כל deploy.
4. מפעילים Deploy. בלוגים אמורה להופיע השורה: `Johnny is connected to Slack (Socket Mode).`

**עלות משוערת:** בערך 5–10 דולר בחודש לשרת, ועוד השימוש ב-API של Anthropic.

## חשוב

- **רק עותק אחד של ג'וני מחובר בכל רגע.** שני חיבורי Socket Mode מפצלים את האירועים ביניהם. כשהשרת עולה, לא מפעילים את הבוט מהסשן בענן.
- **עדכון קוד:** כל push ל-`main` גורם ל-Railway לבנות מחדש. בהפעלה, ג'וני מושך את `main`. אם יש התנגשות עם מה שהוא למד על השרת, הוא ממשיך לרוץ על הקוד שכבר יש לו.
- **לא נבדק עדיין:** בניית ה-Docker image עצמה. בסביבה שבה נבנה הקוד אין Docker. סקריפט ההפעלה (`deploy/start.sh`) כן נבדק: שכפול, עדכון, עצירה כשחסר משתנה, והטוקן לא נשמר בתוך `.git`.
