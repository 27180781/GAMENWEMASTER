# בנייה והגשה של מנוע הטריוויה כאתר סטטי (CapRover / כל Docker host)

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# קובצי ההתקנה של תוכנת האופליין נמשכים **לתוך התמונה**, כדי שהלקוח יוריד
# ויתעדכן מהשרת הזה בלבד ולא יפנה ל-GitHub. המשיכה קורית כאן — בצד השרת,
# בזמן הבנייה — ונכשלת ברעש אם קובץ חסר או שה-sha512 אינו תואם ל-latest.yml.
# ARG לביטול (‎--build-arg DESKTOP_ASSETS=0‎) לבנייה מקומית מהירה.
#
# ⚠ הבנייה הזו רצה *במקביל* לפרסום ה-EXE של אותו קומיט (CapRover בונה בדחיפה
# ל-main, ו-build-desktop מחליף את קובצי המהדורה כמה דקות אחר כך). בחלון
# ההחלפה GitHub עונה 504/404 או מגיש פיד ומתקין לא תואמים — לכן המשיכה נעשית
# בסבבים עם המתנה (ראו fetch-desktop-assets.mjs), ורק אחרי כמה דקות של כישלון
# הבנייה נופלת. הגרסה העדכנית ממילא מגיעה גם מהרענון שרץ בעליית המכולה
# (ראו docker-entrypoint.sh).
ARG DESKTOP_ASSETS=1
ENV DESKTOP_ASSETS=$DESKTOP_ASSETS
RUN node tools/fetch-desktop-assets.mjs dist/desktop

FROM nginx:1.27-alpine
# node נדרש לרענון שרץ ברקע במכולה. ~45MB, ובתמורה השרת מפסיק להיות תלוי
# בתזמון הבנייה — ומהדורה חדשה מגיעה ללקוחות בלי פריסה בכלל.
RUN apk add --no-cache nodejs
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY tools/fetch-desktop-assets.mjs tools/refresh-desktop-assets.mjs /app/tools/
# שם שונה מ-/docker-entrypoint.sh של תמונת nginx: ה-ENTRYPOINT שלה ממשיך לרוץ
# כרגיל (ומריץ את סקריפטי ה-init שלה), ואז מפעיל את ה-CMD הזה במקום nginx.
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 80
CMD ["/entrypoint.sh"]
